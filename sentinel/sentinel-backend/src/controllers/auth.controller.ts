import { createHmac, randomBytes, randomInt, scrypt, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import nodemailer from 'nodemailer';
import { AccountStore } from '../auth/accounts.js';

const deriveKey = promisify(scrypt);
const codeLifetime = 10 * 60_000;
const resendDelay = 60_000;
const sessionLifetime = 8 * 60 * 60_000;
const sessionCookie = 'sentinel_session';
const accountDirectory = fileURLToPath(new URL('../../../auth-data/', import.meta.url));

type Purpose = 'register' | 'reset';
type SendCode = (email: string, code: string, purpose: Purpose) => Promise<void>;
type Challenge = { digest: Buffer | null; expiresAt: number; resendAt: number; attempts: number };

function smtpSender(): SendCode | undefined {
  const user = process.env['SMTP_USER']?.trim();
  const pass = process.env['SMTP_PASS']?.trim();
  if (!user || !pass) return undefined;
  const port = Number(process.env['SMTP_PORT'] ?? 465);
  const transport = nodemailer.createTransport({
    host: process.env['SMTP_HOST'] ?? 'smtp.qq.com',
    port,
    secure: port === 465,
    requireTLS: port !== 465,
    auth: { user, pass },
    connectionTimeout: 8_000,
    greetingTimeout: 8_000,
    socketTimeout: 12_000,
    disableFileAccess: true,
    disableUrlAccess: true,
  });
  return async (email, code, purpose) => {
    const action = purpose === 'reset' ? '密码重置' : '邮箱注册';
    await transport.sendMail({
      from: { name: 'Sentinel', address: user },
      to: { name: '', address: email },
      subject: `Sentinel ${action}验证码`,
      text: `你的 Sentinel ${action}验证码为 ${code}，10 分钟内有效，仅可使用一次。\n如果这次操作由他人发起，请忽略此邮件。`,
    });
  };
}

function readFields(body: unknown) {
  const fields = (body ?? {}) as Record<string, unknown>;
  const email = typeof fields['email'] === 'string' ? fields['email'].trim().toLowerCase() : '';
  const password = typeof fields['password'] === 'string' ? fields['password'] : '';
  const code = typeof fields['code'] === 'string' ? fields['code'].trim() : '';
  return { email, password, code };
}

function validEmail(email: string) {
  return email.length <= 254 && /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(email);
}

function validEmailCode(email: string, password: string, code: string) {
  return validEmail(email) && password.length >= 8 && password.length <= 128 && /^\d{6}$/.test(code);
}

function errorCode(error: unknown) {
  return (error as NodeJS.ErrnoException)?.code;
}

export function registerAuth(app: FastifyInstance, options: { sendCode?: SendCode; dataDir?: string } = {}) {
  const sendCode = options.sendCode ?? smtpSender();
  const directory = options.dataDir ?? process.env['AUTH_DATA_DIR'] ?? accountDirectory;
  let accounts: AccountStore | undefined;
  const accountStore = () => accounts ??= new AccountStore(directory);
  app.addHook('onClose', async () => { accounts?.close(); });
  const secret = randomBytes(32);
  const challenges = new Map<string, Challenge>();
  const pending = new Set<string>();
  const requests = new Map<string, { count: number; until: number }>();
  const sessions = new Map<string, { email: string; expiresAt: number }>();
  const passwordRevisions = new Map<string, symbol>();
  let pruneAfter = 0;

  const challengeKey = (purpose: Purpose, email: string) => purpose + ':' + email;
  const digest = (key: string, code: string) => createHmac('sha256', secret).update(key + ':' + code).digest();

  function currentSession(cookie?: string) {
    const token = cookie?.split(';').map((part) => part.trim()).find((part) => part.startsWith(sessionCookie + '='))
      ?.slice(sessionCookie.length + 1);
    return token && (sessions.get(token)?.expiresAt ?? 0) > Date.now() ? token : undefined;
  }

  function rateLimit(key: string, max: number, interval: number) {
    const now = Date.now();
    if (now >= pruneAfter) {
      pruneAfter = now + resendDelay;
      for (const [id, challenge] of challenges) {
        if (challenge.expiresAt <= now) challenges.delete(id);
      }
      for (const [id, state] of requests) {
        if (state.until <= now) requests.delete(id);
      }
      for (const [token, session] of sessions) if (session.expiresAt <= now) sessions.delete(token);
    }
    const state = requests.get(key);
    if (!state || now >= state.until) {
      requests.set(key, { count: 1, until: now + interval });
      return 0;
    }
    if (state.count >= max) return Math.ceil((state.until - now) / 1000);
    state.count++;
    return 0;
  }

  async function sendChallenge(purpose: Purpose, request: FastifyRequest, reply: FastifyReply) {
    const { email } = readFields(request.body);
    if (!validEmail(email)) return reply.code(400).send({ message: '请输入有效的邮箱地址' });
    if (!sendCode) return reply.code(503).send({ message: '邮件服务尚未配置，请联系管理员' });
    if (pending.has(email)) return reply.code(409).send({ message: '该邮箱正在处理中，请稍后再试' });
    const id = challengeKey(purpose, email);
    const retryAfter = Math.max(
      0,
      Math.ceil(((challenges.get(id)?.resendAt ?? 0) - Date.now()) / 1000),
    );
    const delay = retryAfter || rateLimit('send:' + request.ip, 10, codeLifetime);
    if (delay) return reply.code(429).send({ message: '发送过于频繁，请稍后重试', retryAfter: delay });

    pending.add(email);
    try {
      const exists = Boolean(accountStore().get(email));
      if (purpose === 'register' && exists) return reply.code(409).send({ message: '该邮箱已注册，请直接登录' });
      let proof: Buffer | null = null;
      if (purpose === 'register' || exists) {
        const code = randomInt(1_000_000).toString().padStart(6, '0');
        try {
          await sendCode(email, code, purpose);
        } catch (error) {
          app.log.warn({ code: errorCode(error) }, 'SMTP verification email failed');
          return reply.code(502).send({ message: '验证码发送失败，请稍后再试或联系管理员' });
        }
        proof = digest(id, code);
      }
      const now = Date.now();
      challenges.set(id, { digest: proof, expiresAt: now + codeLifetime, resendAt: now + resendDelay, attempts: 0 });
      return { retryAfter: resendDelay / 1000 };
    } finally {
      pending.delete(email);
    }
  }
  app.post('/api/auth/send-code', async (request, reply) => sendChallenge('register', request, reply));
  app.post('/api/auth/send-reset-code', async (request, reply) => sendChallenge('reset', request, reply));

  async function confirmChallenge(purpose: Purpose, request: FastifyRequest, reply: FastifyReply) {
    const { email, password, code } = readFields(request.body);
    if (!validEmailCode(email, password, code)) {
      return reply.code(400).send({ message: '请输入有效邮箱、8–128 位密码和 6 位验证码' });
    }
    if (pending.has(email)) return reply.code(409).send({ message: '该邮箱正在处理中，请稍后再试' });
    const id = challengeKey(purpose, email);
    const challenge = challenges.get(id);
    if (!challenge || challenge.expiresAt <= Date.now()) {
      challenges.delete(id);
      return reply.code(400).send({ message: '验证码未发送或已过期，请重新获取' });
    }
    if (challenge.attempts >= 5) return reply.code(429).send({ message: '验证码尝试次数已用完，请重新获取' });
    if (!challenge.digest || !timingSafeEqual(challenge.digest, digest(id, code))) {
      challenge.attempts++;
      return reply.code(400).send({ message: '验证码不正确' });
    }

    pending.add(email);
    try {
      const salt = randomBytes(16);
      const key = await deriveKey(password, salt, 64) as Buffer;
      const account = { salt: salt.toString('hex'), key: key.toString('hex') };
      const store = accountStore();
      const saved = purpose === 'reset' ? store.resetPassword(email, account) : store.create(email, account);
      challenges.delete(id);
      if (!saved) {
        return purpose === 'reset'
          ? reply.code(400).send({ message: '验证码未发送或已过期，请重新获取' })
          : reply.code(409).send({ message: '该邮箱已注册，请直接登录' });
      }
      if (purpose === 'reset') {
        passwordRevisions.set(email, Symbol());
        for (const [token, session] of sessions) if (session.email === email) sessions.delete(token);
      }
      return reply.code(purpose === 'register' ? 201 : 200).send({ ok: true });
    } finally {
      pending.delete(email);
    }
  }
  app.post('/api/auth/register', async (request, reply) => confirmChallenge('register', request, reply));
  app.post('/api/auth/reset-password', async (request, reply) => confirmChallenge('reset', request, reply));

  app.post('/api/auth/login', async (request, reply) => {
    const { email, password } = readFields(request.body);
    if (!validEmail(email) || !password || password.length > 128) {
      return reply.code(400).send({ message: '请输入有效的邮箱和密码' });
    }
    const retryAfter = rateLimit('login:' + request.ip, 20, resendDelay);
    if (retryAfter) return reply.code(429).send({ message: '尝试过于频繁，请稍后再试', retryAfter });
    const revision = passwordRevisions.get(email);
    const account = accountStore().get(email);
    const salt = account ? Buffer.from(account.salt, 'hex') : secret.subarray(0, 16);
    const key = await deriveKey(password, salt, 64) as Buffer;
    if (!account || revision !== passwordRevisions.get(email) || !timingSafeEqual(key, Buffer.from(account.key, 'hex'))) {
      return reply.code(401).send({ message: '邮箱或密码不正确' });
    }
    const previous = currentSession(request.headers.cookie);
    if (previous) sessions.delete(previous);
    const token = randomBytes(32).toString('hex');
    sessions.set(token, { email, expiresAt: Date.now() + sessionLifetime });
    reply.header('Cache-Control', 'no-store');
    reply.header('Set-Cookie', `${sessionCookie}=${token}; Path=/api; HttpOnly; SameSite=Strict; Max-Age=${sessionLifetime / 1000}${request.protocol === 'https' ? '; Secure' : ''}`);
    return { ok: true };
  });
  app.get('/api/auth/session', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    return { authenticated: Boolean(currentSession(request.headers.cookie)) };
  });
}
