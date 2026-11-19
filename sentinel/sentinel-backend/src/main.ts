import { buildApp } from './app.js';
const port = Number(process.env['PORT'] ?? 3001);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
const app = buildApp();
try {
  await app.listen({ port, host: process.env['HOST'] ?? '127.0.0.1' });
  console.log(`Sentinel: http://localhost:${port} | ws://localhost:${port}/stream`);
} catch (error: unknown) { console.error(error); await app.close(); process.exitCode = 1; }
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void app.close().catch((error: unknown) => { console.error(error); process.exitCode = 1; }); });
