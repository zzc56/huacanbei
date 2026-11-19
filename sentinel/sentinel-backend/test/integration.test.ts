import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { WebSocket } from 'ws';
import { buildApp } from '../src/app.js';

interface Received { type?: string; timestamp?: number; targets?: { id: string }[]; prediction?: unknown[] }
async function until(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 6000;
  while (!predicate()) { if (Date.now() > deadline) throw new Error('Timed out'); await delay(20); }
}
test('real WS stream, frame rate, selection, REST control, reset and validation', { timeout: 15000 }, async t => {
  const app = buildApp('synthetic');
  await app.listen({ host: '127.0.0.1', port: 0 });
  const address = app.server.address(); assert.ok(address && typeof address !== 'string');
  const socket = new WebSocket(`ws://127.0.0.1:${address.port}/stream`);
  t.after(async () => { socket.terminate(); await app.close(); });
  const messages: Received[] = [], arrival: number[] = [];
  socket.on('message', data => {
    const message = JSON.parse(data.toString()) as Received;
    messages.push(message); if (!message.type) arrival.push(performance.now());
  });
  await once(socket, 'open');
  await until(() => arrival.length >= 12);
  const hz = 11000 / (arrival[11]! - arrival[0]!);
  assert.ok(hz > 8 && hz < 12, `observed ${hz} Hz`);
  t.diagnostic(`measured WebSocket rate: ${hz.toFixed(2)} Hz`);
  const frame = messages.find(m => !m.type && m.targets?.length); assert.ok(frame?.targets?.[0]);
  socket.send(JSON.stringify({ action: 'select_target', targetId: frame.targets[0].id }));
  await until(() => messages.some(m => m.type === 'target_detail' && m.prediction?.length === 11));
  assert.equal((await app.inject({ method: 'POST', url: '/api/control', payload: { action: 'pause' } })).statusCode, 200);
  await delay(100); const count = arrival.length; await delay(250); assert.equal(arrival.length, count);
  assert.equal((await app.inject('/api/history')).statusCode, 200);
  assert.equal((await app.inject({ method: 'POST', url: '/api/control', payload: { action: 'reset' } })).statusCode, 200);
  assert.equal((await app.inject('/api/history')).json<{ frames: unknown[] }>().frames.length, 0);
  assert.equal((await app.inject({ method: 'POST', url: '/api/control', payload: { action: 'play' } })).statusCode, 200);
  await until(() => arrival.length > count);
  assert.equal((await app.inject({ method: 'POST', url: '/api/control', payload: { action: 'invalid' } })).statusCode, 400);
  assert.equal((await app.inject('/api/history?limit=999')).statusCode, 400);
  assert.equal((await app.inject({ url: '/api/config', headers: { origin: 'https://untrusted.example' } })).statusCode, 403);
  const preview = await app.inject({ url: '/api/config', headers: { origin: 'http://127.0.0.1:4173' } });
  assert.equal(preview.headers['access-control-allow-origin'], 'http://127.0.0.1:4173');
  assert.equal((await app.inject({ method: 'OPTIONS', url: '/api/control', headers: { origin: 'http://127.0.0.1:4173', 'access-control-request-method': 'POST' } })).statusCode, 204);
  await delay(120); socket.send('{bad'); await until(() => messages.some(m => m.type === 'error'));
});
