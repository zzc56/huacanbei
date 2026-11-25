import assert from 'node:assert/strict';
import test from 'node:test';
import { performance } from 'node:perf_hooks';
import { StockLidarReader } from '../src/vehicle/stock-lidar.js';
import { StockTelemetryReader } from '../src/vehicle/stock-telemetry.js';
import { evaluateOnboardRadarRisk } from '../src/vehicle/risk.js';

test('real lidar distinguishes a nearest echo, a valid empty sweep, and missing scans', () => {
  const lidar = new StockLidarReader();
  assert.equal(lidar.snapshot(0).status, 'waiting');
  lidar.receive('{R7:2100:2:495:-160}$', 100, 5100);
  assert.deepEqual(lidar.snapshot(110).sample, {
    sequence: 7, capturedTickMs: 2100, receivedAtMs: 5100,
    observations: [{ rangeM: .495, bearingDeg: -1.6 }],
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

test('a multi-target scan keeps six targets in the risk field and rejects incomplete reports', () => {
  const lidar = new StockLidarReader();
  lidar.receive('{RM9:2100:6:850:-1850:1000:-1550:420:1800:1500:500:1100:1100:1250:-800}$', 100, 5100);
  const scan = lidar.snapshot(110).sample;
  assert.equal(scan?.observations.length, 6);
  assert.equal(scan?.nearest?.rangeM, .42);
  const risk = evaluateOnboardRadarRisk(lidar.snapshot(110), .40);
  assert.equal(risk?.obstacles.length, 6);
  assert.equal(risk?.motion.action, 'stop');
  lidar.receive('{RM10:2300:2:710:0}$', 200, 5200);
  lidar.receive('{RM11:2500:1:710:2100}$', 230, 5230);
  assert.equal(lidar.snapshot(230).sample?.sequence, 9);
  lidar.receive('{RM12:2700:0}$', 300, 5300);
  assert.deepEqual(lidar.snapshot(300).sample?.observations, []);
  lidar.receive('{RM12:2700:-1}$', 800, 5800);
  assert.equal(lidar.snapshot(800).status, 'offline');
});

test('serial input keeps a fragmented six-target frame alongside wheel reports', () => {
  const serial = new StockTelemetryReader('COM11');
  const packet = '{RM4294967295:4294967295:6' +
    [1250,1400,1550,1700,1850,2000].map(distance=>`:${distance}:-2000`).join('') + '}$';
  serial['receive']('{A0:0:40:0:0}$' + packet.slice(0,-1));
  assert.equal(serial.radarForMotion(performance.now()).status,'waiting');
  serial['receive'](packet.slice(-1));
  assert.equal(serial.radarForMotion(performance.now()).sample?.observations.length,6);
  assert.equal(serial.wheelFeedbackForMotion(performance.now())?.batteryPercent,40);
});

test('the six near echoes reported for one obstacle contribute only one target and still stop', () => {
  const lidar = new StockLidarReader();
  lidar.receive('{RM1:100:6:160:-920:160:-140:160:-1050:160:-80:170:-590:170:-1310}$', 100, 5100);
  const preview = lidar.snapshot(100);
  assert.equal(preview.sample?.observations.length, 1);
  assert.equal(preview.sample?.nearest?.rangeM, .16);
  const risk = evaluateOnboardRadarRisk(preview, .40);
  assert.equal(risk?.obstacles.length, 1);
  assert.equal(risk?.motion.action, 'stop');
  lidar.receive('{RM2:200:3:160:-920:170:-1310:760:1000}$', 200, 5200);
  assert.deepEqual(lidar.snapshot(200).sample?.observations.map(point => point.rangeM), [.16, .76]);
});

test('grouping keeps the echo with the shorter forward distance at the braking threshold', () => {
  const lidar = new StockLidarReader();
  lidar.receive('{RM1:100:2:401:0:402:600}$', 100, 5100);
  const preview = lidar.snapshot(100);
  assert.deepEqual(preview.sample?.observations, [{ rangeM: .402, bearingDeg: 6 }]);
  assert.equal(evaluateOnboardRadarRisk(preview, .40)?.motion.action, 'stop');
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
