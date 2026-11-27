import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import { WebSocket } from 'ws';
import { buildApp } from '../src/app.js';
import type { DriveSnapshot } from '../src/vehicle/contracts.js';
import { StockTelemetryReader } from '../src/vehicle/stock-telemetry.js';

test('vehicle drive stays stopped until a real test mode is armed', { timeout: 6000 }, async () => {
  const app = buildApp('vehicle');
  await app.listen({ host: '127.0.0.1', port: 0 });
  const ws = new WebSocket(app.listeningOrigin.replace('http:', 'ws:') + '/api/vehicle/drive');
  const snapshot = async () => {
    const [data] = await once(ws, 'message');
    return JSON.parse(data.toString()) as DriveSnapshot;
  };
  try {
    const initial = await snapshot();
    assert.deepEqual(initial.telemetry, { port: process.env['SENTINEL_VEHICLE_PORT'] ?? 'COM11', sample: null, status: 'idle' });
    assert.equal(initial.bench, undefined);
    assert.deepEqual(Object.keys(initial), ['telemetry']);

    for (const action of ['forward', 'bench:radar']) {
      const next = snapshot();
      ws.send(action);
      assert.deepEqual(await next, initial);
    }
  } finally {
    ws.terminate();
    await app.close();
  }
});

test('a serial owner can confirm only the current stationary pose and a manual move invalidates it', { timeout: 6000 }, async t => {
  const origin = 'http://127.0.0.1:4173';
  const id = 'a231b03c-7bc8-42be-a33d-97b4d8c9996a';
  let sample = {wheelAMps:0,wheelBMps:0,batteryPercent:70,receivedAtMs:Date.now()};
  t.mock.method(StockTelemetryReader.prototype,'start',() => {});
  t.mock.method(StockTelemetryReader.prototype,'snapshot',() => ({port:'COM11',status:'online',sample}));
  t.mock.method(StockTelemetryReader.prototype,'stationaryForMotion',() => ({id,sinceMs:sample.receivedAtMs}));
  t.mock.method(StockTelemetryReader.prototype,'wheelFeedbackForMotion',() => sample);
  const app = buildApp('vehicle');
  await app.listen({host:'127.0.0.1',port:0});
  const ws = new WebSocket(app.listeningOrigin.replace('http:', 'ws:') + '/api/vehicle/drive', {origin});
  function next(predicate: (snapshot: DriveSnapshot) => boolean) {
    return new Promise<DriveSnapshot>(resolve => {
      function receive(data: {toString(): string}) {
        const state = JSON.parse(data.toString()) as DriveSnapshot;
        if (!predicate(state)) return;
        ws.off('message',receive);
        resolve(state);
      }
      ws.on('message',receive);
    });
  }
  try {
    await next(state => state.telemetry?.status === 'idle');
    const owned = next(state => state.telemetry?.status === 'online');
    ws.send('telemetry:open');
    await owned;
    const rejected = next(state => state.odometry?.status === 'reset_required');
    ws.send('pose:old-id:1:2:90');
    await rejected;
    sample = {...sample,receivedAtMs:Date.now()};
    const accepted = next(state => state.odometry?.status === 'tracking');
    ws.send(`pose:${id}:1:2:90`);
    const tracking = await accepted;
    assert.equal(tracking.bench,undefined);
    assert.ok(tracking.odometry?.status === 'tracking' && tracking.odometry.pose.xM === 1 && tracking.odometry.pose.yM === 2);
    const invalidated = next(state => state.odometry?.status === 'reset_required');
    sample = {...sample,wheelAMps:.1,wheelBMps:.1,receivedAtMs:Date.now()};
    await invalidated;
  } finally {
    ws.terminate();
    await app.close();
  }
});
