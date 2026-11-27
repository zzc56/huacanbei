import assert from 'node:assert/strict';
import test from 'node:test';
import { BenchDrive } from '../src/vehicle/bench-drive.js';
import type { ScanPoint, StockLidarPreview } from '../src/vehicle/contracts.js';
import { evaluateVehicleRisk } from '../src/vehicle/risk.js';

function fixture(fusionRisk?: ConstructorParameters<typeof BenchDrive>[3]) {
  const sample = { wheelAMps: 0, wheelBMps: 0, batteryPercent: 40, receivedAtMs: 0 };
  const commands: string[] = [];
  let latest = { mmps: 350, readAt: 90 };
  let fresh = true;
  let wheels = sample;
  let radar: StockLidarPreview;
  let sequence = 0;
  function radarTargets(observations: ScanPoint[]) {
    radar = { status: 'online', sample: {
      sequence: ++sequence, capturedTickMs: 100, receivedAtMs: 100,
      observations,
      nearest: [...observations].sort((a, b) => a.rangeM - b.rangeM)[0] ?? null,
    } };
  }
  const radarDistance = (rangeM: number | null) => radarTargets(rangeM === null ? [] : [{rangeM, bearingDeg:0}]);
  radarDistance(null);
  const serial = {
    freshForMotion: () => fresh,
    radarForMotion: () => radar,
    wheelFeedbackForMotion: () => fresh ? wheels : null,
    setting: () => latest,
    send: (command: string) => { commands.push(command); return true; },
  };
  const drive = new BenchDrive(serial, 100, sample, fusionRisk);
  return { drive, commands, sample, confirm: (mmps = 400) => { latest = { mmps, readAt: 115 }; },
    wheelSpeed: (wheelAMps: number, wheelBMps: number) => { wheels = { ...sample, wheelAMps, wheelBMps }; },
    stale: () => { fresh = false; }, radarDistance, radarTargets,
    radarStale: () => { radar = { status: 'stale', sample: null }; } };
}

test('the final trial requires a fresh 0.40 m/s ACK before motion and restores the original speed on exit', () => {
  const { drive, commands, confirm, sample } = fixture();
  drive.command('forward', 110);
  confirm(120);
  drive.command('forward', 116);
  assert.deepEqual(commands, ['arm-radar']);
  assert.equal(drive.snapshot(118).phase, 'arming');
  confirm();
  drive.snapshot(120);
  assert.equal(drive.snapshot(125).speedLimitMps, .40);
  drive.command('forward', 125);
  drive.command('stop', 135);
  drive.end(200, sample);
  assert.deepEqual(commands, ['arm-radar','forward','stop','stop','restore-350']);
});

test('multiple radar targets stop motion according to their forward corridor distance', () => {
  const { drive, commands, confirm, radarTargets } = fixture();
  confirm(); drive.snapshot(120); drive.command('forward', 130);
  radarTargets([{ rangeM: .85, bearingDeg: -18 }, { rangeM: .42, bearingDeg: 20 }]);
  const state = drive.snapshot(140);
  assert.equal(state.radarTrial.state, 'obstacle');
  assert.equal(state.speedLimitMps, 0);
  assert.deepEqual(commands, ['arm-radar', 'forward', 'stop']);
});

test('fusion can stop for a camera-only obstacle and fails closed when alignment is lost', () => {
  let cameraBlocks = false, aligned = true;
  const { drive, commands, confirm } = fixture((radar, speedMps) => {
    if (!aligned || !radar.sample) return null;
    const capturedAtMs = radar.sample.receivedAtMs;
    return evaluateVehicleRisk({
      pose:{xM:0,yM:0,headingDeg:0,speedMps,capturedAtMs},
      lidar:{observations:radar.sample.observations,capturedAtMs},
      camera:{observations:cameraBlocks ? [{xM:.55,yM:.65,velocity:{xMps:-.85,yMps:0}}] : [],capturedAtMs},
    }, capturedAtMs, undefined, true, .40, true);
  });
  confirm(); drive.snapshot(120); drive.command('forward', 130);
  cameraBlocks = true;
  const stopped = drive.snapshot(140);
  assert.equal(stopped.radarTrial.state, 'obstacle');
  assert.match(stopped.message, /监控预测.*提前停车/);
  drive.command('heartbeat',145);
  assert.deepEqual(commands, ['arm-radar', 'forward', 'stop']);
  drive.command('stop', 150);
  cameraBlocks = false;
  drive.command('forward', 160);
  aligned = false;
  assert.equal(drive.snapshot(170).phase, 'stopped');
  assert.deepEqual(commands, ['arm-radar', 'forward', 'stop', 'forward', 'stop']);
});

test('the final trial stops at 40 cm and holds the stop until forward is released', () => {
  const { drive, commands, confirm, radarDistance } = fixture();
  drive.command('forward', 110);
  assert.deepEqual(commands, ['arm-radar']);
  confirm();
  drive.snapshot(120);
  radarDistance(.401);
  assert.equal(drive.snapshot(125).speedLimitMps, .40);
  assert.equal(drive.snapshot(125).radarTrial.stopDistanceM, .40);
  drive.command('forward', 130);
  radarDistance(.40);
  const stopped = drive.snapshot(180);
  assert.equal(stopped.direction, 'stop');
  assert.equal(stopped.speedLimitMps, 0);
  assert.equal(stopped.radarTrial.state, 'obstacle');
  drive.command('heartbeat', 190);
  assert.equal(drive.snapshot(191).direction, 'stop');
  radarDistance(null);
  drive.command('heartbeat', 195);
  drive.command('forward', 200);
  assert.equal(drive.snapshot(205).radarTrial.state, 'release');
  assert.deepEqual(commands, ['arm-radar', 'forward', 'stop']);
  drive.command('stop', 210);
  drive.command('forward', 220);
  drive.command('stop', 230);
  assert.deepEqual(commands, ['arm-radar', 'forward', 'stop', 'forward', 'stop']);
});

test('radar loss stops real motion and requires the trial to be armed again', () => {
  const { drive, commands, confirm, radarStale, radarDistance } = fixture();
  confirm();
  drive.snapshot(120);
  drive.command('forward', 130);
  radarStale();
  const stopped = drive.snapshot(180);
  assert.equal(stopped.phase, 'stopped');
  assert.equal(stopped.radarTrial.state, 'unavailable');
  assert.equal(stopped.speedLimitMps, 0);
  radarDistance(1);
  drive.command('heartbeat', 190);
  drive.command('forward', 195);
  assert.deepEqual(commands, ['arm-radar', 'forward', 'stop']);
});

test('radar stopping distance compares the reading at stop with a fresh sweep after both wheels stop', () => {
  const { drive, commands, confirm, radarDistance, wheelSpeed } = fixture();
  confirm();
  drive.snapshot(120);
  radarDistance(1.07);
  drive.command('forward', 130);
  wheelSpeed(.39, .41);
  drive.command('stop', 180);
  const measurement = (now: number) => drive.snapshot(now).radarTrial.measurement;
  assert.deepEqual(commands, ['arm-radar','forward','stop']);
  assert.deepEqual(measurement(181), { status: 'measuring', beforeM: 1.07, wheelSpeedMps: .40 });
  wheelSpeed(0, .02);
  radarDistance(1.04);
  assert.equal(measurement(210)?.status, 'measuring');
  wheelSpeed(0, 0);
  assert.equal(measurement(220)?.status, 'measuring');
  radarDistance(1.02);
  assert.equal(measurement(240)?.status, 'measuring');
  radarDistance(1.01);
  const result = measurement(310);
  assert.equal(result?.status, 'complete');
  assert.equal(result.afterM, 1.01);
  assert.ok(Math.abs(result.reductionM - .06) < 1e-9);
  assert.deepEqual(commands, ['arm-radar','forward','stop']);
});

test('the final trial expires without a keyboard heartbeat, and wheel feedback loss cannot resume motion', () => {
  const { drive, commands, confirm, stale } = fixture();
  confirm(); drive.snapshot(120);
  drive.command('forward', 130);
  drive.command('heartbeat', 210);
  drive.snapshot(300);
  assert.equal(drive.snapshot(460).phase, 'stopped');
  drive.command('heartbeat', 470);
  drive.command('forward', 480);
  assert.deepEqual(commands, ['arm-radar','forward','forward','forward','stop']);

  const disconnected = fixture();
  disconnected.confirm(); disconnected.drive.snapshot(120);
  disconnected.drive.command('forward', 130);
  disconnected.stale();
  assert.equal(disconnected.drive.snapshot(150).phase, 'stopped');
  disconnected.drive.command('forward', 160);
  assert.deepEqual(disconnected.commands, ['arm-radar','forward','stop']);
});
