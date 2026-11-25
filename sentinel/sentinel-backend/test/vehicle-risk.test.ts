import assert from 'node:assert/strict';
import test from 'node:test';
import { buildApp } from '../src/app.js';
import { evaluateVehicleRisk, type VehicleFrame } from '../src/vehicle/risk.js';
import type { VehicleResult } from '../src/vehicle/contracts.js';

test('车路观测进入同一张风险图，输出巡航、提前减速和停车', async t => {
  const app = buildApp('vehicle');
  t.after(() => app.close());
  await app.ready();

  const frame = (): VehicleFrame => {
    const capturedAtMs = Date.now();
    return {
      pose: { xM: 1, yM: 1, headingDeg: 90, speedMps: 0.22, capturedAtMs },
      camera: { capturedAtMs, observations: [] },
      lidar: { capturedAtMs, observations: [] },
    };
  };
  async function evaluate(payload: VehicleFrame) {
    const res = await app.inject({ method: 'POST', url: '/api/vehicle/risk', payload });
    assert.equal(res.statusCode, 200, res.body);
    return res.json<{
      obstacles: { xM: number; yM: number; source: string }[];
      corridorRisk: number | null;
      motion: { action: string; speedLimitMps: number; reason: string };
    }>();
  }

  const clear = await evaluate(frame());
  assert.equal(clear.motion.action, 'cruise');
  assert.equal(clear.corridorRisk, 0);

  const upstream = frame();
  upstream.camera!.observations.push({ xM: 1.65, yM: 1 });
  const early = await evaluate(upstream);
  assert.equal(early.obstacles[0]?.source, 'camera');
  assert.ok(Math.abs(early.obstacles[0]!.yM - 0.65) < 1e-6);
  assert.equal(early.motion.action, 'slow');
  assert.ok(early.motion.speedLimitMps < clear.motion.speedLimitMps);
  assert.ok(early.corridorRisk! > 0);

  const overlap = frame();
  overlap.camera!.observations.push({ xM: 1.65, yM: 1 });
  overlap.lidar!.observations.push({ rangeM: 0.65, bearingDeg: 0 });
  const fused = await evaluate(overlap);
  assert.equal(fused.obstacles.length, 1);
  assert.equal(fused.obstacles[0]?.source, 'both');
  assert.ok(Math.abs(fused.corridorRisk! - early.corridorRisk!) < 1e-6);

  const obstacle = frame();
  obstacle.lidar!.observations.push({ rangeM: 0.2, bearingDeg: 0 });
  assert.equal((await evaluate(obstacle)).motion.reason, 'near_obstacle');
  assert.equal((await evaluate({ ...frame(), lidar: null })).motion.speedLimitMps, 0);

  const stale = frame();
  stale.camera!.capturedAtMs -= 500;
  stale.camera!.observations.push({ xM: 1.15, yM: 1 });
  const staleResult = await evaluate(stale);
  assert.equal(staleResult.motion.reason, 'camera_unavailable');
  assert.equal(staleResult.obstacles.length, 0);

  const invalid = frame();
  invalid.lidar!.observations.push({ rangeM: -1, bearingDeg: 0 });
  const rejected = await app.inject({ method: 'POST', url: '/api/vehicle/risk', payload: invalid });
  assert.equal(rejected.statusCode, 400);
});

test('移动障碍即将进入弯道时，固定摄像头观测可触发停车判定', () => {
  const pedestrian = { xM: .9, yM: 1.30 };
  const frame: VehicleFrame = {
    pose: { xM: 0, yM: .75, headingDeg: 0, speedMps: 0, capturedAtMs: 1000 },
    camera: { capturedAtMs: 1000, observations: [pedestrian] },
    lidar: { capturedAtMs: 1000, observations: [] },
  };
  const corner = { forwardM: .25, rightM: 1.10 };
  assert.equal(evaluateVehicleRisk(frame, 1000, corner).motion.action, 'cruise');
  frame.camera!.observations = [{ ...pedestrian, velocity: { xMps: 0, yMps: -.5 } }];
  const entering = evaluateVehicleRisk(frame, 1000, corner);
  assert.equal(entering.motion.action, 'stop');
  assert.equal(entering.motion.reason, 'blind_corner');
});

test('按位姿时间补偿雷达距离，丢弃不同步的观测，保留相邻但不匹配的目标', () => {
  const frame: VehicleFrame = {
    pose: { xM: 1, yM: 1, headingDeg: 90, speedMps: 0.2, capturedAtMs: 1000 },
    camera: { capturedAtMs: 980, observations: [{ xM: 1.5, yM: 1 }, { xM: 1.5, yM: 1.4 }] },
    lidar: { capturedAtMs: 900, observations: [{ rangeM: 0.52, bearingDeg: 0 }] },
  };
  const aligned = evaluateVehicleRisk(frame, 1000);
  assert.deepEqual(aligned.observations.camera, { ...frame.camera, includedInFusion: true });
  assert.deepEqual(aligned.observations.lidar, { ...frame.lidar, includedInFusion: true });
  assert.deepEqual(aligned.obstacles.map(o => o.source), ['both', 'camera']);
  assert.ok(Math.abs(aligned.obstacles[0]!.yM - 0.50) < 1e-6);
  assert.equal(evaluateVehicleRisk(frame, 1300).field, null);
  frame.lidar!.capturedAtMs--;
  const skewed = evaluateVehicleRisk(frame, 1000);
  assert.equal(skewed.motion.speedLimitMps, 0);
  assert.deepEqual(skewed.observations.lidar, { ...frame.lidar, includedInFusion: false });
  assert.deepEqual(skewed.observations.camera, { ...frame.camera, includedInFusion: false });
  const cameraOnly = evaluateVehicleRisk({ ...frame, lidar: null }, 1000);
  assert.equal(cameraOnly.field, null);
  assert.deepEqual(cameraOnly.observations, { camera: { ...frame.camera, includedInFusion: false }, lidar: null });
  const radarOnly = evaluateVehicleRisk({ ...frame, camera: { capturedAtMs: 800, observations: [] },
    lidar: { capturedAtMs: 1000, observations: [] } }, 1000);
  assert.equal(radarOnly.observations.camera?.includedInFusion, false);
  assert.equal(radarOnly.observations.lidar?.includedInFusion, true);
});

test('接口观测失效后清空热图，拒绝乱序帧、未来帧和非法数值', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: 2000 });
  const app = buildApp('vehicle');
  t.after(() => app.close());
  const frame: VehicleFrame = {
    pose: { xM: 0, yM: 0, headingDeg: 0, speedMps: 0.1, capturedAtMs: 2000 },
    camera: null, lidar: { capturedAtMs: 2000, observations: [{ rangeM: 0.2, bearingDeg: 0 }] },
  };
  const post = (payload: object) => app.inject({ method: 'POST', url: '/api/vehicle/risk', payload });
  assert.equal((await post(frame)).statusCode, 200);
  assert.equal((await post({ ...frame, pose: { ...frame.pose, capturedAtMs: 1999 } })).statusCode, 409);
  assert.equal((await post({ ...frame, pose: { ...frame.pose, xM: null } })).statusCode, 400);
  assert.equal((await post({ ...frame, lidar: { capturedAtMs: 2300, observations: [] } })).statusCode, 400);
  const current = (await app.inject('/api/vehicle/frame')).json<VehicleResult>();
  assert.equal(current.motion.reason, 'near_obstacle');
  assert.equal(current.lidarCount, 1);
  t.mock.timers.tick(251);
  const stale = (await app.inject('/api/vehicle/frame')).json<VehicleResult>();
  assert.equal(stale.field, null);
  assert.deepEqual(stale.observations, { camera: null, lidar: null });
  assert.equal(stale.motion.speedLimitMps, 0);
});

test('障碍中心均在通道外时，伸入通道的风险场也能独立触发减速', () => {
  const frame: VehicleFrame = {
    pose: { xM: 0, yM: 0, headingDeg: 0, speedMps: 0.22, capturedAtMs: 1000 },
    camera: { capturedAtMs: 1000, observations: [0.32, 0.46, 0.60].map(yM => ({ xM: 0.21, yM })) },
    lidar: { capturedAtMs: 1000, observations: [] },
  };
  const result = evaluateVehicleRisk(frame, 1000);
  assert.equal(result.closestForwardM, null);
  assert.ok(result.corridorRisk! > 0.5);
  assert.equal(result.motion.action, 'slow');
});
