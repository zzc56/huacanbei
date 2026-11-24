import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const maximumBytes = 256 * 1024 * 1024;
const defaultDirectory = fileURLToPath(new URL('../../../replay-data/', import.meta.url));

export function registerReplayLibrary(app: FastifyInstance) {
  const directory = process.env['REPLAY_DATA_DIR'] ?? defaultDirectory;
  let database: DatabaseSync | undefined;
  function db() {
    if (database) return database;
    mkdirSync(directory, { recursive: true });
    const connection = new DatabaseSync(join(directory, 'replays.sqlite'));
    try {
      connection.exec(`
        PRAGMA busy_timeout = 5000;
        CREATE TABLE IF NOT EXISTS replays (
          id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at INTEGER NOT NULL,
          duration_ms INTEGER NOT NULL, archive BLOB NOT NULL
        );
      `);
      database = connection;
      return connection;
    } catch (error) {
      connection.close();
      throw error;
    }
  }
  app.addHook('onClose', async () => { database?.close(); });
  void app.register(async routes => {
    routes.addContentTypeParser('application/zip', { parseAs: 'buffer', bodyLimit: maximumBytes }, (_request, body, done) => {
      done(null, body);
    });
    routes.addHook('onRequest', async (request, reply) => {
      if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(request.ip)) {
        return reply.code(403).send({ message: '请在项目运行的本机访问回放库。' });
      }
      reply.header('Cache-Control', 'no-store');
    });
    routes.get('/api/replays', async () =>
      db().prepare('SELECT id, name, created_at AS createdAt, duration_ms AS durationMs FROM replays ORDER BY created_at DESC').all(),
    );
    routes.post<{ Querystring: { name?: string; durationMs?: string } }>('/api/replays', { bodyLimit: maximumBytes }, async (request, reply) => {
      const archive = request.body;
      const name = typeof request.query.name === 'string' ? request.query.name.trim() : '';
      const durationMs = Number(request.query.durationMs);
      if (!Buffer.isBuffer(archive) || archive.length < 22 || archive.readUInt32LE() !== 0x04034b50 ||
          !name || name.length > 120 || !Number.isSafeInteger(durationMs) || durationMs <= 0) {
        return reply.code(400).send({ message: '回放文件或名称无效。' });
      }
      const id = randomUUID();
      const createdAt = Date.now();
      db().prepare('INSERT INTO replays (id, name, created_at, duration_ms, archive) VALUES (?, ?, ?, ?, ?)')
        .run(id, name, createdAt, durationMs, archive);
      return reply.code(201).send({ id, name, createdAt, durationMs });
    });
    routes.get<{ Params: { id: string } }>('/api/replays/:id', async (request, reply) => {
      const id = request.params.id;
      const item = db().prepare('SELECT archive FROM replays WHERE id = ?').get(id);
      if (!item?.['archive']) return reply.code(404).send({ message: '找不到这条回放记录。' });
      return reply.type('application/zip')
        .header('Content-Disposition', `attachment; filename="sentinel-${id}.zip"`)
        .send(Buffer.from(item['archive'] as Uint8Array));
    });
  });
}
