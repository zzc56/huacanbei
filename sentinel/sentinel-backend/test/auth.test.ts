import assert from 'node:assert/strict';
import { createHash, randomBytes, scryptSync } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import Fastify from 'fastify';
import { registerAuth } from '../src/controllers/auth.controller.js';

test('email registration requires the one-time code sent to that address and persists the account', async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), 'sentinel-auth-'));
  const app = Fastify();
  const restarted = Fastify();
  t.after(async () => {
    await app.close();
    await restarted.close();
    await rm(dataDir, { recursive: true, force: true });
  });

  let delivery: { email: string; code: string } | undefined;
  registerAuth(app, {
    dataDir,
    sendCode: async (email, code) => { delivery = { email, code }; },
  });
  const post = (path: string, payload: Record<string, string>) =>
    app.inject({ method: 'POST', url: '/api/auth/' + path, payload });

  const password = 'A test password';
  const email = 'driver@example.com';
  assert.equal((await post('login', { email, password })).statusCode, 401);
  const sent = await post('send-code', { email: ' Driver@Example.com ' });
  assert.equal(sent.statusCode, 200);
  assert.deepEqual(sent.json(), { retryAfter: 60 });
  assert.equal(delivery?.email, email);
  const code = delivery?.code ?? '';
  assert.match(code, /^\d{6}$/);
  assert.equal((await post('send-code', { email })).statusCode, 429);
  assert.equal((await post('register', { email: 'other@example.com', password, code })).statusCode, 400);
  const wrongCode = code === '000000' ? '111111' : '000000';
  assert.equal((await post('register', { email, password, code: wrongCode })).statusCode, 400);
  const results = await Promise.all([
    post('register', { email, password, code }),
    post('register', { email, password, code }),
  ]);
  assert.deepEqual(results.map((result) => result.statusCode).sort(), [201, 409]);
  assert.equal((await post('register', { email, password, code })).statusCode, 400);

  assert.deepEqual(await readdir(dataDir), ['accounts.sqlite']);
  const accounts = new DatabaseSync(join(dataDir, 'accounts.sqlite'), { readOnly: true });
  try {
    const stored = accounts.prepare('SELECT * FROM accounts').get()!;
    assert.match(String(stored.email_hash), /^[a-f0-9]{64}$/);
    assert.match(String(stored.password_salt), /^[a-f0-9]{32}$/);
    assert.match(String(stored.password_hash), /^[a-f0-9]{128}$/);
    assert.ok(Number(stored.created_at) > 0);
  } finally { accounts.close(); }

  registerAuth(restarted, { dataDir });
  const login = (candidate: string) => restarted.inject({
    method: 'POST', url: '/api/auth/login', payload: { email, password: candidate },
  });
  assert.equal((await login('wrong password')).statusCode, 401);
  assert.equal((await login(password)).statusCode, 200);
});

test('an SMTP error does not report a successful delivery or consume the resend cooldown', async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), 'sentinel-smtp-failure-'));
  const app = Fastify();
  t.after(async () => {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  });
  let attempts = 0;
  registerAuth(app, {
    dataDir,
    sendCode: async () => {
      attempts++;
      if (attempts === 1) throw new Error('Simulated delivery failure');
    },
  });
  const send = () => app.inject({
    method: 'POST', url: '/api/auth/send-code', payload: { email: 'driver@example.com' },
  });
  assert.equal((await send()).statusCode, 502);
  assert.equal((await send()).statusCode, 200);
  assert.equal(attempts, 2);
});

test('migration preserves the old password, then keeps the new SQLite password across restart', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'sentinel-legacy-accounts-'));
  const email = 'legacy@example.com';
  const original = 'Original file password';
  const replacement = 'New database password';
  const salt = randomBytes(16);
  const path = join(dataDir, createHash('sha256').update(email).digest('hex') + '.json');
  const legacy = JSON.stringify({ salt: salt.toString('hex'), key: scryptSync(original, salt, 64).toString('hex') });
  await writeFile(path, legacy);
  const first = Fastify();
  const second = Fastify();
  try {
    let code: string | undefined;
    registerAuth(first, { dataDir, sendCode: async (_email, value) => { code = value; } });
    const post = (app: typeof first, action: string, payload: Record<string, string>) =>
      app.inject({ method: 'POST', url: '/api/auth/' + action, payload });
    assert.equal((await post(first, 'login', { email, password: original })).statusCode, 200);
    assert.equal((await post(first, 'send-code', { email })).statusCode, 409);
    assert.equal((await post(first, 'send-reset-code', { email })).statusCode, 200);
    assert.match(code ?? '', /^\d{6}$/);
    assert.equal((await post(first, 'reset-password', { email, code: code!, password: replacement })).statusCode, 200);
    await first.close();
    registerAuth(second, { dataDir });
    assert.equal((await post(second, 'login', { email, password: original })).statusCode, 401);
    assert.equal((await post(second, 'login', { email, password: replacement })).statusCode, 200);
    assert.equal(await readFile(path, 'utf8'), legacy);
  } finally {
    await first.close();
    await second.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test('password reset uses a separate one-time code, persists the new password and revokes old sessions', async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), 'sentinel-reset-'));
  const app = Fastify();
  const restarted = Fastify();
  t.after(async () => {
    await app.close();
    await restarted.close();
    await rm(dataDir, { recursive: true, force: true });
  });
  const deliveries = new Map<string, string>();
  registerAuth(app, {
    dataDir,
    sendCode: async (email, code, purpose) => { deliveries.set(purpose + ':' + email, code); },
  });
  const post = (path: string, payload: Record<string, string>) =>
    app.inject({ method: 'POST', url: '/api/auth/' + path, payload });
  const email = 'driver@example.com';
  const missing = 'unregistered@example.com';
  const original = 'An original password';
  const replacement = 'A different password';
  assert.equal((await post('send-code', { email })).statusCode, 200);
  const registrationCode = deliveries.get('register:' + email)!;
  assert.equal((await post('register', { email, password: original, code: registrationCode })).statusCode, 201);
  const login = await post('login', { email, password: original });
  assert.equal(login.statusCode, 200);
  const cookie = String(login.headers['set-cookie']).split(';')[0]!;
  const session = () => app.inject({ url: '/api/auth/session', headers: { cookie } });
  assert.deepEqual((await session()).json(), { authenticated: true });

  assert.equal((await post('reset-password', { email, password: replacement, code: registrationCode })).statusCode, 400);
  const sent = await post('send-reset-code', { email: ' Driver@Example.COM ' });
  const noAccount = await post('send-reset-code', { email: missing });
  assert.equal(sent.statusCode, 200);
  assert.equal(noAccount.statusCode, 200);
  assert.deepEqual(sent.json(), noAccount.json());
  assert.equal(deliveries.has('reset:' + missing), false);
  assert.equal((await post('send-reset-code', { email })).statusCode, 429);
  const resetCode = deliveries.get('reset:' + email)!;
  assert.match(resetCode, /^\d{6}$/);
  assert.equal((await post('reset-password', { email: missing, password: replacement, code: resetCode })).statusCode, 400);
  assert.equal((await post('register', { email, password: replacement, code: resetCode })).statusCode, 400);
  const wrong = resetCode === '000000' ? '000001' : '000000';
  assert.equal((await post('reset-password', { email, password: replacement, code: wrong })).statusCode, 400);
  const payload = { email, password: replacement, code: resetCode };
  const results = await Promise.all([post('reset-password', payload), post('reset-password', payload)]);
  assert.deepEqual(results.map(result => result.statusCode).sort(), [200, 409]);
  assert.equal((await post('reset-password', payload)).statusCode, 400);
  assert.deepEqual((await session()).json(), { authenticated: false });
  assert.equal((await post('login', { email, password: original })).statusCode, 401);
  assert.equal((await post('login', { email, password: replacement })).statusCode, 200);
  assert.equal((await readdir(dataDir)).length, 1);

  registerAuth(restarted, { dataDir });
  const persisted = await restarted.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password: replacement } });
  assert.equal(persisted.statusCode, 200);
});
