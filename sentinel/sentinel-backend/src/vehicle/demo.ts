import { evaluateVehicleRisk, vehicleLimits, type VehicleFrame } from './risk.js';

const tickMs = 100;

// One stationary pedestrian at (2, 1) on the ground. The car starts at (1, 1)
// and faces +X. Only the car moves, using the previous frame's speed limit.
export function makePedestrianFrame(travelM: number, speedMps: number, capturedAtMs: number): VehicleFrame {
  const distanceM = 1 - travelM;
  return {
    pose: { xM: 1 + travelM, yM: 1, headingDeg: 90, speedMps, capturedAtMs },
    camera: { capturedAtMs, observations: distanceM <= 0.69 ? [{ xM: 2, yM: 1, trackId:'P1' }] : [] },
    lidar: { capturedAtMs, observations: distanceM <= 0.50 ? [{ rangeM: distanceM, bearingDeg: 0, trackId:'L1' }] : [] },
  };
}

export function buildVehicleDemo() {
  const frames: VehicleFrame[] = [];
  const stages: number[] = [];
  let travelM = 0, speed = vehicleLimits.cruiseLimitMps, lastStage = '';
  for (let step = 0; step <= 150; step++) {
    const time = step * tickMs;
    const frame = makePedestrianFrame(travelM, speed, time);
    const result = evaluateVehicleRisk(frame, time);
    frames.push(frame);
    const stage = result.motion.action + '/' + (result.obstacles[0]?.source ?? 'clear');
    if (stage !== lastStage) stages.push(step);
    lastStage = stage;
    if (result.motion.action === 'stop') break;
    speed = result.motion.speedLimitMps;
    travelM += speed * tickMs / 1000;
  }
  return { frames, stages, tickMs };
}
