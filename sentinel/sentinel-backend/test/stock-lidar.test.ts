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

test('interleaved B reports refresh measured wheel speeds without replacing the battery reading', () => {
  const serial = new StockTelemetryReader('COM11');
  serial['receive']('{A0:0:40:0:0}${B400:39:41}$');
  const now = performance.now();
  const feedback = serial.wheelFeedbackForMotion(now);
  assert.equal(feedback?.wheelAMps, .39);
  assert.equal(feedback?.wheelBMps, .41);
  assert.equal(feedback?.batteryPercent, 40);
  assert.equal(serial.setting()?.mmps, 400);
  assert.equal(serial.wheelFeedbackForMotion(now + 351), null);
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

test('the extended firmware frame carries six distances up to 25 m across serial chunks', () => {
  const serial = new StockTelemetryReader('COM11');
  const packet = '{RN4294967295:4294967295:6' +
    [10000,12500,15000,17500,20000,25000].map(distance => `:${distance}:-2000`).join('') + '}$';
  assert.equal(packet.length, 100);
  serial['receive']('{A0:0:40:0:0}$' + packet.slice(0,-1));
  assert.equal(serial.radarForMotion(performance.now()).status, 'waiting');
  serial['receive'](packet.slice(-1) + '{B400:39:41}$');
  const radar = serial.radarForMotion(performance.now());
  assert.equal(radar.maxRangeM, 25);
  assert.deepEqual(radar.displayObservations?.map(point => point.rangeM), [10,12.5,15,17.5,20,25]);
  assert.equal(serial.setting()?.mmps, 400);
  serial['receive']('{RN0:0:1:25001:0}$');
  assert.equal(serial.radarForMotion(performance.now()).sample?.sequence, 4294967295);
});

test('alternating duplicate returns and 1 cm / 0.1 degree jitter keep one stable display target', () => {
  const reader = new StockLidarReader();
  for (let sequence = 1; sequence <= 30; ++sequence) {
    const now = sequence * 200;
    reader.receive(`{RN${sequence}:${now}:${sequence % 2 ? '3:800:0:809:9:810:10' : '1:810:10'}}$`, now, 5000 + now);
    const frame = reader.snapshot(now);
    assert.equal(frame.sample?.observations.length, 1);
    assert.deepEqual(frame.displayObservations, [{ rangeM: 0.8, bearingDeg: 0, trackId: 'L1' }]);
  }
});

test('the reported 34 cm surface contributes one target through dense and sparse scans', () => {
  const reader = new StockLidarReader();
  reader.receive('{RN1:200:6:340:-1140:340:-1470:340:-1320:340:-1590:340:-1400:340:-1640}$', 200, 5200);
  const first = reader.snapshot(200);
  assert.equal(first.sample?.observations.length, 1);
  assert.equal(first.sample?.brakingObservations?.length, 6);
  assert.equal(evaluateOnboardRadarRisk(first, 0)?.obstacles.length, 1);
  assert.equal(evaluateOnboardRadarRisk(first, 0)?.motion.action, 'stop');

  reader.receive('{RN2:400:2:339:-1470:343:-1400}$', 400, 5400);
  assert.equal(reader.snapshot(400).sample?.observations.length, 1);
  reader.receive('{RN3:600:1:341:-1310}$', 600, 5600);
  assert.equal(reader.snapshot(600).displayObservations?.[0]?.trackId, first.displayObservations?.[0]?.trackId);
});

test('real 11 cm returns with large bearing gaps keep one position in the list and risk map', () => {
  const reader = new StockLidarReader();
  const returns = [
    '112:-622:112:-426:112:-231:112:-166:112:-101:112:29',
    '112:-1398:112:149:113:-431:113:-300:113:-236:113:-172',
    '111:-1010:112:-1074:112:-54:112:395:113:-1461:113:-1397',
    '112:-893:112:648:113:-703:113:-639:113:-321:113:-258',
    '113:-1451:113:-160:113:-31:113:33:113:98:113:229',
    '112:-17:114:-467:114:-274:114:-145:114:1795:115:-1372',
  ];
  let firstTarget;
  returns.forEach((points, index) => {
    const ms = 200 * (index + 1);
    reader.receive(`{RN${index + 1}:${ms}:6:${points}}$`, ms, 5000 + ms);
    const radar = reader.snapshot(ms);
    assert.equal(radar.sample?.brakingObservations?.length, 6);
    assert.equal(radar.displayObservations?.length, 1);
    const preview = evaluateOnboardRadarRisk(radar, 0, true);
    assert.equal(preview?.obstacles.length, 1);
    const target = radar.displayObservations?.[0];
    firstTarget ??= target;
    assert.deepEqual(target, firstTarget);
    assert.deepEqual(preview?.observations.lidar?.observations, radar.displayObservations);
    assert.equal(preview?.motion.action, 'stop');
  });
});

test('a persistent near-field split becomes two targets after three distinct scans', () => {
  const reader = new StockLidarReader();
  reader.receive('{RN1:200:1:110:0}$', 200, 5200);
  for (let index = 2; index <= 6; ++index) {
    const now = index * 200;
    reader.receive(`{RN${index}:${now}:2:111:-1200:112:1300}$`, now, 5000 + now);
    assert.equal(reader.snapshot(now).sample?.observations.length, index < 4 ? 1 : 2);
  }
});

test('a near-field split is confirmed independently of a farther obstacle', () => {
  const reader = new StockLidarReader();
  reader.receive('{RN1:200:2:110:0:700:1200}$', 200, 5200);
  for (let index = 2; index <= 4; ++index) {
    const now = index * 200;
    reader.receive(`{RN${index}:${now}:3:111:-1200:112:1300:700:1200}$`, now, 5000 + now);
    const observations = reader.snapshot(now).sample?.observations;
    assert.equal(observations?.length, index < 4 ? 2 : 3);
    assert.equal(observations?.at(-1)?.rangeM, .7);
  }
});

test('an isolated lateral return does not move the display but a sustained move does', () => {
  const reader = new StockLidarReader();
  [-600, 700, -600, 700, 700, 700].forEach((bearing, index) => {
    const now = 200 * (index + 1);
    reader.receive(`{RN${index + 1}:${now}:1:112:${bearing}}$`, now, 5000 + now);
    assert.equal(reader.snapshot(now).displayObservations?.[0]?.bearingDeg, index < 5 ? -6 : 7);
  });
});

test('the measured slanted 25 cm obstacle keeps one track and leaves the background return', () => {
  const reader = new StockLidarReader();
  const returns = [
    '5:230:-520:241:-1514:250:438:274:1016:389:1828',
    '4:233:-322:237:-1414:249:701:390:1850',
    '6:232:-450:247:-1513:254:513:260:1152:276:1024:329:1215',
    '6:232:-399:241:-1462:250:371:265:882:362:1232:390:1751',
  ];
  let firstTarget;
  returns.forEach((fields, index) => {
    const now = 200 * (index + 1);
    reader.receive(`{RN${index + 1}:${now}:${fields}}$`, now, 5000 + now);
    const radar = reader.snapshot(now);
    const foreground = radar.displayObservations?.filter(point => point.rangeM < .35);
    assert.equal(foreground?.length, 1);
    firstTarget ??= foreground?.[0];
    assert.deepEqual(foreground?.[0], firstTarget);
    if (fields.includes('389:1828')) assert.ok(radar.sample?.observations.some(point => point.rangeM === .389));
    assert.equal(evaluateOnboardRadarRisk(radar, 0)?.motion.action, 'stop');
  });
});

test('separated runs and depth changes leave independently resolved objects in the report', () => {
  const reader = new StockLidarReader();
  reader.receive('{RN1:200:6:340:-1690:341:-1560:340:-1490:350:-1130:351:-1010:400:-890}$', 200, 5200);
  const frame = reader.snapshot(200);
  assert.equal(frame.sample?.observations.length, 4);
  assert.deepEqual(frame.sample?.observations.slice(1).map(point => point.rangeM), [.35,.351,.4]);
});

test('grouping retains braking evidence from the side of a surface inside the driving corridor', () => {
  const reader = new StockLidarReader();
  reader.receive('{RN1:200:3:535:1850:535:1920:535:2000}$', 200, 5200);
  const frame = reader.snapshot(200);
  assert.deepEqual(frame.sample?.observations, [{rangeM: .535, bearingDeg: 19.25}]);
  assert.ok((evaluateOnboardRadarRisk(frame, 0)?.closestForwardM ?? Infinity) < .51);
});

test('two resolved nearby targets retain their display IDs when distance order reverses', () => {
  const reader = new StockLidarReader();
  reader.receive('{RN1:100:2:500:-50:510:50}$', 100, 5100);
  reader.receive('{RN2:300:2:500:50:510:-50}$', 300, 5300);
  const frame = reader.snapshot(300);
  assert.deepEqual(frame.sample?.observations.map(point => point.bearingDeg), [0.5, -0.5]);
  assert.deepEqual(frame.displayObservations, [
    { rangeM: 0.50, bearingDeg: -0.5, trackId: 'L1' },
    { rangeM: 0.51, bearingDeg: 0.5, trackId: 'L2' },
  ]);
});

test('display stabilization does not delay a braking threshold crossing or preserve missing observations', () => {
  const reader = new StockLidarReader();
  reader.receive('{RN1:100:1:409:0}$', 100, 5100);
  reader.receive('{RN2:300:1:399:0}$', 300, 5300);
  const radar = reader.snapshot(300);
  assert.equal(radar.displayObservations?.[0]?.rangeM, 0.409);
  assert.equal(radar.sample?.nearest?.rangeM, 0.399);
  assert.equal(evaluateOnboardRadarRisk(radar, 0.40)?.motion.action, 'stop');

  reader.receive('{RN3:500:0}$', 500, 5500);
  assert.deepEqual(reader.snapshot(500).displayObservations, []);
  reader.receive('{RN4:700:-1}$', 700, 5700);
  assert.deepEqual(reader.snapshot(700), { status: 'offline', sample: null });
});
