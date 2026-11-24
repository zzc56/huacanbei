import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { buildApp } from '../src/app.js';
import { CameraFrameStore } from '../src/live/camera.js';
import { calibratedPoint, prepareCalibration } from '../src/live/calibration.js';
import type { RadarObservation } from '../src/live/tcr300.js';
import { LiveVehicleMatcher, RadarTimeline } from '../src/live/vehicle-matching.js';

const settings = {
  width: 800, height: 448, cameraOffsetMs: 120, alignmentWindowMs: 50,
  points: [
    { u: .2, v: .3, x: -6, y: 40 }, { u: .8, v: .3, x: 6, y: 40 },
    { u: .8, v: .9, x: 6, y: 10 }, { u: .2, v: .9, x: -6, y: 10 },
  ],
};
const start = Date.parse('2026-01-05T10:00:00.000Z');

test('projects road-plane points inside the calibration coverage and rejects degenerate inputs', () => {
  const calibration = prepareCalibration(settings);
  const projected = calibratedPoint(calibration, .5, .5);
  assert.ok(projected);
  assert.ok(Math.abs(projected.x) < 1e-8 && Math.abs(projected.y - 30) < 1e-8);
  assert.equal(calibratedPoint(calibration, .1, .5), undefined);
  assert.throws(() => prepareCalibration({ ...settings, points: settings.points.map(point => ({ ...point, y: 10 })) }), /分散取点/);
  assert.throws(() => prepareCalibration({ ...settings, points: [...settings.points, { u: .5, v: .5, x: 20, y: 50 }] }));
});

function radar(track_id: number, time: number, x_lateral = .25, y_longitudinal = 30): RadarObservation {
  return { track_id, host_received_utc: new Date(time).toISOString(), target_seq: 1, x_lateral, y_longitudinal,
    range: 30, angle: 0, rcs: 0, vx_lateral: 0, vy_longitudinal: -10 };
}

const frame = (sequence: number, time: number) => ({
  sequence, captured_utc: new Date(time).toISOString(), width: 800, height: 448, imageUrl: '',
  detections: [
    { label: 'car', x: 380, y: 184, width: 40, height: 40, score: .94, track_id: 'V00001' },
    { label: 'truck', x: 380, y: 184, width: 40, height: 40, score: .7, track_id: 'V00002' },
  ],
});

test('matches after two time-aligned camera frames and omits duplicate boxes and ambiguous radar tracks', () => {
  const calibration = prepareCalibration(settings);
  const timeline = new RadarTimeline();
  const matcher = new LiveVehicleMatcher();
  for (let i = 0; i < 4; i++) {
    const time = start + i * 100, observed = time - 120;
    const candidates = [radar(7, observed)];
    if (i >= 2) candidates.push(radar(9, observed, .4));
    for (const target of candidates) timeline.record(target, observed);
    const links = matcher.match(frame(i + 1, time), candidates, timeline, calibration, time + 10);
    if (i !== 1) assert.deepEqual(links, []);
    else {
      assert.equal(links.length, 1);
      assert.equal(links[0]?.radarId, 'radar:7');
      assert.equal(links[0]?.detectionIndex, 0);
      assert.equal(links[0]?.timeDeltaMs, 0);
      assert.ok(Math.abs(links[0]!.distanceM - .25) < 1e-8);
    }
  }
  const wrongSign = prepareCalibration({ ...settings, cameraOffsetMs: -120 });
  assert.deepEqual(matcher.match(frame(5, start + 400), [radar(7, start + 280)], timeline, wrongSign, start + 530), []);
});


test('a recycled radar ID must establish a new live match', () => {
  const calibration = prepareCalibration(settings);
  const timeline = new RadarTimeline();
  const matcher = new LiveVehicleMatcher();
  for (let i = 0; i < 4; i++) {
    const time = start + i * 100;
    const target = { ...radar(7, time - 120), track_start_seq: i < 2 ? 1 : 3 };
    timeline.record(target, time - 120);
    if (i === 2) {
      assert.deepEqual(matcher.match(frame(2, time - 100), [target], timeline, calibration, time), []);
    }
    const links = matcher.match(frame(i + 1, time), [target], timeline, calibration, time);
    assert.equal(links.length, i % 2);
    if (links.length) assert.equal(links[0]?.radarTrackStart, target.track_start_seq);
  }
});

test('buffers the exact camera frame for a negative offset and clears unavailable data', () => {
  const camera = new CameraFrameStore();
  camera.setAlignmentDelay(3800);
  for (let i = 0; i < 51; i++) {
    const capturedAt = start + i * 100;
    const input = frame(i + 1, capturedAt);
    assert.ok(camera.accept({ ...input, capturedAt, jpeg: '/9j/2Q==' }, capturedAt));
  }
  assert.equal(camera.snapshot(start + 5000).vision?.sequence, 51);
  assert.equal(camera.snapshot(start + 5000, 3800).vision?.sequence, 13);
  assert.equal(camera.snapshot(start + 1500, 2000).vision, null);
  assert.equal(camera.snapshot(start + 6600, 3800).vision, null);
});

test('control-point lookup uses the nearest measured radar coordinate and keeps its original time', () => {
  const timeline = new RadarTimeline();
  const before = radar(5, start, 2);
  const after = radar(5, start + 100, 4);
  timeline.record(before, start);
  timeline.record(after, start + 100);
  assert.deepEqual(timeline.align([after], start + 60, 80, false), [
    { id: 5, x: 4, y: 30, timeDeltaMs: 40, timestamp: start + 100 },
  ]);
  assert.deepEqual(timeline.align([after], start + 60, 80), [
    { id: 5, x: 3.2, y: 30, timeDeltaMs: 40, timestamp: start + 60 },
  ]);
});

test('live calibration is saved atomically beside existing device settings and loaded across restarts', async t => {
  const folder = await mkdtemp(join(tmpdir(), 'sentinel-live-calibration-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const devicesFile = join(folder, 'devices.json');
  const cameraConfig = { enabled: false, fps: 10 };
  await writeFile(devicesFile, JSON.stringify({ camera: cameraConfig }));
  const options = { host: '127.0.0.1', port: 1, localAddress: '', devicesFile, camera: { url: '' } };
  const app = buildApp('live', options);
  try {
    assert.deepEqual((await app.inject('/api/live/calibration')).json(), { calibration: null });
    const invalid = await app.inject({ method: 'POST', url: '/api/live/calibration', payload: { ...settings, points: [] } });
    assert.equal(invalid.statusCode, 400);
    const saved = await app.inject({ method: 'POST', url: '/api/live/calibration', payload: settings });
    assert.equal(saved.statusCode, 200);
    assert.deepEqual(saved.json().calibration.settings, settings);
    assert.deepEqual(JSON.parse(await readFile(devicesFile, 'utf8')).camera, cameraConfig);
    assert.equal((await app.inject('/api/live/status')).json().association.state, 'waiting');
    assert.equal((await app.inject('/api/live/calibration/observations?sequence=1&offset=120&window=50')).statusCode, 404);
  } finally { await app.close(); }
  const restarted = buildApp('live', options);
  try {
    assert.deepEqual((await restarted.inject('/api/live/calibration')).json().calibration.settings, settings);
    const replacement = await restarted.inject({ method: 'POST', url: '/api/live/radar-settings',
      payload: { host: '127.0.0.1', port: 2, localAddress: '' } });
    assert.equal(replacement.statusCode, 200);
    assert.deepEqual((await restarted.inject('/api/live/calibration')).json(), { calibration: null });
  } finally { await restarted.close(); }
});
