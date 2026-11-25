import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import { WebSocket } from 'ws';
import { buildApp } from '../src/app.js';
import type { DriveSnapshot } from '../src/vehicle/contracts.js';

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
