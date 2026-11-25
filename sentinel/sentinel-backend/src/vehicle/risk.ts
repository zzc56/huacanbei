import type { Target } from '../contracts.js';
import { config } from '../config.js';
import { RiskFieldEngine } from '../engines/risk-field.engine.js';
import type { CameraPoint, GroundPoint, RightTurnCorridor, ScanPoint, SensorSample, StockLidarPreview, VehicleObstacle as Obstacle, VehicleResult } from './contracts.js';

export interface VehicleFrame {
  pose: GroundPoint & { headingDeg: number; speedMps: number; capturedAtMs: number };
  camera: (SensorSample<CameraPoint> & { sequence?: number }) | null;
  lidar: SensorSample<ScanPoint> | null;
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

export function evaluateVehicleRisk(frame: VehicleFrame | null, now: number, corner?: RightTurnCorridor, requireCamera = true): VehicleResult {
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
  const visionPoints = cameraReady ? camera.observations.map(({ xM, yM, velocity }, cameraIndex): Obstacle => {
    const dx = xM - pose.xM, dy = yM - pose.yM;
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
  const scanPoints = lidar.observations.map(({ rangeM, bearingDeg, velocity }, lidarIndex): Obstacle => ({
    xM: rangeM * Math.sin(bearingDeg * radians), yM: rangeM * Math.cos(bearingDeg * radians) + scanOffsetM, source: 'lidar', lidarIndex,
    ...(velocity && { velocity }),
  }));
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
  const closest = [...scanPoints, ...visionPoints].reduce((distance, point) => {
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

  const motion: VehicleResult['motion'] = decisionDistance <= vehicleLimits.stopDistanceM
    ? { action: 'stop', speedLimitMps: 0, reason: cornerBlocks ? 'blind_corner' : 'near_obstacle' }
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

export function evaluateOnboardRadarRisk(radar: StockLidarPreview, speedMps: number): VehicleResult | null {
  if (radar.status !== 'online' || !radar.sample) return null;
  const { nearest, receivedAtMs } = radar.sample;
  // The radar scan already uses local vehicle coordinates. The view does not require a site pose.
  return evaluateVehicleRisk({
    pose: { xM: 0, yM: 0, headingDeg: 0, speedMps, capturedAtMs: receivedAtMs },
    camera: null,
    lidar: { observations: nearest ? [nearest] : [], capturedAtMs: receivedAtMs },
  }, receivedAtMs, undefined, false);
}
