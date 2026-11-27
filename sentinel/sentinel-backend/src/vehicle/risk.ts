import type { Target } from '../contracts.js';
import { config } from '../config.js';
import { RiskFieldEngine } from '../engines/risk-field.engine.js';
import type { CameraPoint, RightTurnCorridor, ScanPoint, SensorSample, StockLidarPreview, VehicleObstacle as Obstacle, VehiclePose, VehicleResult } from './contracts.js';
import { radarTrialSettings } from './contracts.js';

export interface VehicleFrame {
  pose: VehiclePose;
  camera: (SensorSample<CameraPoint> & { sequence?: number }) | null;
  lidar: SensorSample<ScanPoint> | null;
  lidarBrakingObservations?: readonly ScanPoint[] | undefined;
}

const radians = Math.PI / 180;
const grid = { xMin: -1.25, yMin: 0, width: 50, height: 60, resolution: 0.05 };
export const vehicleLimits = {
  maxAgeMs: 250, maxSkewMs: 100, matchDistanceM: 0.15,
  corridorHalfWidthM: 0.18, lookAheadM: 1, slowDistanceM: 0.8, stopDistanceM: 0.25,
  cruiseLimitMps: 0.22, slowLimitMps: 0.1,
};
// Low-speed indoor risk parameters. All lengths are in metres.
const riskParameters = { ...config.risk, distanceScale: 0.8, speedScale: 0.35,
  ttcScale: 1.2, sigma: 0.14, predictionSeconds: 0.35 };

function occupancyInterval(position: number, velocity: number, min: number, max: number) {
  if (Math.abs(velocity) < 0.001) return position >= min && position <= max ? [-Infinity, Infinity] as const : null;
  const first = (min - position) / velocity, second = (max - position) / velocity;
  return [Math.min(first, second), Math.max(first, second)] as const;
}

function mergeObservations(lidar: Obstacle[], camera: Obstacle[]): Obstacle[] {
  const pairs = lidar.flatMap((point, l) => camera.flatMap((vision, c) => {
    const distance = Math.hypot(point.xM - vision.xM, point.yM - vision.yM);
    return distance <= vehicleLimits.matchDistanceM ? [{ l, c, distance }] : [];
  }));
  const matchedLidar = new Map<number, number>();
  const matchedCamera = new Set<number>();
  for (const { l, c } of pairs.sort((a, b) => a.distance - b.distance)) {
    if (!matchedLidar.has(l) && !matchedCamera.has(c)) {
      matchedLidar.set(l,c);
      matchedCamera.add(c);
    }
  }
  return [
    ...lidar.map((point, i): Obstacle => {
      const cameraIndex = matchedLidar.get(i);
      if (cameraIndex === undefined) return point;
      const velocity = point.velocity ?? camera[cameraIndex]?.velocity;
      return { ...point, source: 'both', cameraIndex, ...(velocity && { velocity }) };
    }),
    ...camera.filter((_, i) => !matchedCamera.has(i)),
  ];
}

export function evaluateVehicleRisk(frame: VehicleFrame | null, now: number, corner?: RightTurnCorridor,
                                    requireCamera = true, stopDistanceM = vehicleLimits.stopDistanceM,
                                    predictCameraApproach = false): VehicleResult {
  const pose = frame?.pose;
  const fresh = (time: number) => time <= now && now - time <= vehicleLimits.maxAgeMs;
  const camera = frame?.camera && fresh(frame.camera.capturedAtMs) ? frame.camera : null;
  const lidar = frame?.lidar && fresh(frame.lidar.capturedAtMs) ? frame.lidar : null;
  const aligned = (a: number, b: number) => Math.abs(a - b) <= vehicleLimits.maxSkewMs;
  const lidarReady = !!pose && fresh(pose.capturedAtMs) && !!lidar && aligned(pose.capturedAtMs, lidar.capturedAtMs);
  const cameraReady = lidarReady && !!camera && aligned(camera.capturedAtMs, pose.capturedAtMs) &&
    aligned(camera.capturedAtMs, lidar.capturedAtMs);
  const observations = {
    camera: camera && { ...camera, includedInFusion: cameraReady },
    lidar: lidar && { ...lidar, includedInFusion: lidarReady },
  };
  if (!lidarReady) {
    return { evaluatedAtMs: now, observations, obstacles: [], field: null, corridorRisk: null, closestForwardM: null,
      cameraCount: null, lidarCount: null,
      motion: { action: 'stop', speedLimitMps: 0, reason: 'pose_or_lidar_unavailable' } };
  }

  // Shared ground coordinates use a clockwise heading from +Y. Vehicle X is right, Y forward.
  const sin = Math.sin(pose.headingDeg * radians), cos = Math.cos(pose.headingDeg * radians);
  const visionOffset = cameraReady ? (pose.capturedAtMs - camera.capturedAtMs) / 1000 : 0;
  const visionPoints = cameraReady ? camera.observations.map(({ xM, yM, velocity }, cameraIndex): Obstacle => {
    const dx = xM + (velocity?.xMps ?? 0) * visionOffset - pose.xM;
    const dy = yM + (velocity?.yMps ?? 0) * visionOffset - pose.yM;
    return {
      xM: dx * cos - dy * sin, yM: dx * sin + dy * cos, source: 'camera', cameraIndex,
      ...(velocity && { velocity: {
        xMps: velocity.xMps * cos - velocity.yMps * sin,
        yMps: velocity.xMps * sin + velocity.yMps * cos,
      } }),
    };
  }) : [];
  // Move the earlier/later scan to the pose timestamp for a straight-moving car and static obstacles.
  const scanOffsetM = pose.speedMps * (lidar.capturedAtMs - pose.capturedAtMs) / 1000;
  function projectScan(points: readonly ScanPoint[]): Obstacle[] {
    return points.map(({ rangeM, bearingDeg, velocity }, lidarIndex) => ({
      xM: rangeM * Math.sin(bearingDeg * radians), yM: rangeM * Math.cos(bearingDeg * radians) + scanOffsetM, source: 'lidar', lidarIndex,
      ...(velocity && { velocity }),
    }));
  }
  const scanPoints = projectScan(lidar.observations);
  const brakingScanPoints = frame.lidarBrakingObservations ? projectScan(frame.lidarBrakingObservations) : scanPoints;
  const obstacles = mergeObservations(scanPoints, visionPoints);

  const targets = obstacles.map(({ xM, yM, velocity }, i): Target => {
    const distance = Math.hypot(xM, yM);
    const vx = velocity?.xMps ?? 0, vy = (velocity?.yMps ?? 0) - pose.speedMps;
    return {
      id: `obstacle:${i + 1}`,
      fusion: { x: xM, y: yM, speed: Math.hypot(vx, vy), heading: Math.atan2(vx, vy) / radians,
        azimuth: Math.atan2(xM, yM) / radians,
        radialVelocity: distance > 0 ? (vx * xM + vy * yM) / distance : 0,
        tangentialVelocity: distance > 0 ? (vx * yM - vy * xM) / distance : 0 },
      risk: { value: 0, level: 'low' },
    };
  });
  const { values } = new RiskFieldEngine(grid, 'circular', riskParameters).compute(targets);
  const halfWidth = vehicleLimits.corridorHalfWidthM;
  function onExit(x: number, y: number) {
    return corner && x > halfWidth && x <= corner.rightM && Math.abs(y - corner.forwardM) <= halfWidth;
  }
  function distanceAlongPath(x: number, y: number) {
    if (corner && onExit(x, y)) return corner.forwardM + x;
    if (Math.abs(x) <= halfWidth && y >= 0 && (!corner || y <= corner.forwardM + halfWidth))
      return corner ? Math.min(y, corner.forwardM) : y;
    return Infinity;
  }
  let corridorRisk = 0;
  for (const [i, value] of values.entries()) {
    const x = grid.xMin + (i % grid.width + 0.5) * grid.resolution;
    const y = (Math.floor(i / grid.width) + 0.5) * grid.resolution;
    if (distanceAlongPath(x, y) <= vehicleLimits.lookAheadM) corridorRisk = Math.max(corridorRisk, value);
  }
  function predicted(point: Obstacle) {
    const horizon = riskParameters.predictionSeconds;
    return {
      xM: point.xM + (point.velocity?.xMps ?? 0) * horizon,
      yM: point.yM + (point.velocity?.yMps ?? 0) * horizon,
    };
  }
  const closest = [...brakingScanPoints, ...visionPoints].reduce((distance, point) => {
    const next = predicted(point);
    return Math.min(distance, distanceAlongPath(point.xM, point.yM), distanceAlongPath(next.xM, next.yM));
  }, Infinity);
  // Stop before entering an occupied blind corner while the far obstacle is visible only to the camera.
  const guardedCorner = corner && obstacles.some(point => {
    if (point.source !== 'camera') return false;
    const next = predicted(point);
    return onExit(point.xM, point.yM) || onExit(next.xM, next.yM);
  })
    ? corner.forwardM : Infinity;
  const decisionDistance = Math.min(guardedCorner, closest);
  const cornerBlocks = guardedCorner < closest && guardedCorner <= vehicleLimits.slowDistanceM;
  const approachSpeed = Math.max(pose.speedMps, radarTrialSettings.speedMmps / 1000);
  const poseAge = (now - pose.capturedAtMs) / 1000;
  const cameraApproach = predictCameraApproach && visionPoints.some(point => {
    const lateral = occupancyInterval(point.xM, point.velocity?.xMps ?? 0, -halfWidth, halfWidth);
    const forward = occupancyInterval(point.yM, (point.velocity?.yMps ?? 0) - approachSpeed, 0, stopDistanceM);
    // Test whether a camera obstacle and the vehicle can occupy the braking zone at the same time.
    return lateral && forward && Math.max(0, lateral[0], forward[0]) <= Math.min(poseAge + 0.85, lateral[1], forward[1]);
  });

  const motion: VehicleResult['motion'] = decisionDistance <= stopDistanceM
    ? { action: 'stop', speedLimitMps: 0, reason: cornerBlocks ? 'blind_corner' : 'near_obstacle' }
    : cameraApproach ? { action: 'stop', speedLimitMps: 0, reason: 'camera_approach' }
    : decisionDistance <= vehicleLimits.slowDistanceM || corridorRisk >= riskParameters.threshold
      ? { action: 'slow', speedLimitMps: vehicleLimits.slowLimitMps, reason: cornerBlocks ? 'blind_corner' : 'forward_risk' }
      : requireCamera && !cameraReady
        ? { action: 'slow', speedLimitMps: vehicleLimits.slowLimitMps, reason: 'camera_unavailable' }
        : { action: 'cruise', speedLimitMps: vehicleLimits.cruiseLimitMps, reason: 'path_clear' };
  return { evaluatedAtMs: now, observations, obstacles, field: { ...grid, values: Array.from(values),
    corridorHalfWidthM: halfWidth, lookAheadM: vehicleLimits.lookAheadM, ...(corner && { corner }) }, corridorRisk, motion,
    closestForwardM: Number.isFinite(closest) ? closest : null,
    cameraCount: cameraReady ? visionPoints.length : null, lidarCount: scanPoints.length };
}

export function evaluateOnboardRadarRisk(radar: StockLidarPreview, speedMps: number, presentTracks = false): VehicleResult | null {
  if (radar.status !== 'online' || !radar.sample) return null;
  const { observations, brakingObservations, receivedAtMs } = radar.sample;
  // The radar scan already uses local vehicle coordinates. The view does not require a site pose.
  return evaluateVehicleRisk({
    pose: { xM: 0, yM: 0, headingDeg: 0, speedMps, capturedAtMs: receivedAtMs },
    camera: null,
    lidar: { observations: presentTracks ? radar.displayObservations ?? observations : observations, capturedAtMs: receivedAtMs },
    lidarBrakingObservations: brakingObservations ?? observations,
  }, receivedAtMs, undefined, false, radarTrialSettings.stopDistanceM);
}
