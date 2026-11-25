import assert from 'node:assert/strict';
import test from 'node:test';
import { StockLidarReader } from '../src/vehicle/stock-lidar.js';
import { evaluateOnboardRadarRisk } from '../src/vehicle/risk.js';

test('real lidar distinguishes a nearest echo, a valid empty sweep, and missing scans', () => {
  const lidar = new StockLidarReader();
  assert.equal(lidar.snapshot(0).status, 'waiting');
  lidar.receive('{R7:2100:2:495:-160}$', 100, 5100);
  assert.deepEqual(lidar.snapshot(110).sample, {
    sequence: 7, capturedTickMs: 2100, receivedAtMs: 5100,
    nearest: { rangeM: .495, bearingDeg: -1.6 },
  });
  assert.equal(lidar.snapshot(551, 450).status, 'stale');
  assert.equal(lidar.snapshot(551).status, 'online');
  lidar.receive('{R7:2100:2:495:-160}$', 730, 5730);
  assert.deepEqual(lidar.snapshot(751), { status: 'stale', sample: null });
  lidar.receive('{R8:2800:1:0:0}$', 752, 5752);
  assert.equal(lidar.snapshot(752).status, 'online');
  assert.equal(lidar.snapshot(752).sample?.nearest, null);
  assert.deepEqual(lidar.recentScans(752,450).map(scan=>scan.sequence),[8]);
  lidar.receive('{R8:2800:0:0:0}$', 760, 5760);
  assert.deepEqual(lidar.snapshot(760), { status: 'offline', sample: null });
  assert.deepEqual(lidar.recentScans(760,450),[]);
  lidar.receive('{R8:2800:1:0:0}$', 761, 5761);
  assert.equal(lidar.snapshot(761).status, 'offline');
  lidar.receive('{R9:3000:2:500:2200}$', 762, 5762);
  assert.equal(lidar.snapshot(762).status, 'offline');
  lidar.receive('{R9:3010:2:1000:0}$', 763, 5763);
  assert.equal(lidar.snapshot(763).sample?.nearest?.rangeM, 1);
});

test('onboard radar draws its own field from serial scans without a camera or a site pose', () => {
  const lidar = new StockLidarReader();
  lidar.receive('{R1:100:2:600:1000}$', 100, 5100);
  const risk = evaluateOnboardRadarRisk(lidar.snapshot(110), .40);
  assert.ok(risk && risk.field);
  assert.ok(risk.field.values.some(value => value > 0));
  assert.deepEqual(risk.observations.camera, null);
  assert.deepEqual(risk.obstacles.map(obstacle => obstacle.source), ['lidar']);
  assert.ok(Math.abs(risk.obstacles[0]!.xM - .6 * Math.sin(Math.PI / 18)) < 1e-9);

  lidar.receive('{R2:200:1:0:0}$', 200, 5200);
  assert.deepEqual(lidar.recentScans(200,450).map(scan=>scan.sequence),[2,1]);
  const empty = evaluateOnboardRadarRisk(lidar.snapshot(200), 0);
  assert.ok(empty && empty.field);
  assert.ok(empty.field.values.every(value => value === 0));
  assert.equal(empty.motion.reason, 'path_clear');
  assert.equal(evaluateOnboardRadarRisk(lidar.snapshot(851), 0), null);
});
