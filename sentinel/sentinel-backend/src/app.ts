import Fastify from 'fastify';
import { registerApi } from './controllers/api.controller.js';
import { registerStream } from './controllers/stream.controller.js';
import { PipelineService } from './services/pipeline.service.js';
import { registerRecording } from './recording/replay.js';
import { registerLive, type LiveOptions } from './live/service.js';

export function buildApp(mode = process.env['SOURCE_MODE'] ?? 'recording', liveOptions: LiveOptions = {}) {
  const app = Fastify({ logger: false, bodyLimit: 2048, ajv: { customOptions: { removeAdditional: false } } });
  const origins = new Set((process.env['ALLOWED_ORIGINS'] ?? 'http://localhost:5173,http://127.0.0.1:5173,http://localhost:4173,http://127.0.0.1:4173').split(','));
  app.addHook('onRequest', async (request, reply) => {
    const origin = request.headers.origin;
    if (origin && !origins.has(origin)) return reply.code(403).send({ error: 'Origin forbidden' });
    if (origin) reply.header('Access-Control-Allow-Origin', origin).header('Vary', 'Origin');
    if (request.method === 'OPTIONS') return reply.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS').header('Access-Control-Allow-Headers', 'Content-Type').code(204).send();
  });
  if (mode === 'live') {
    registerLive(app, origins, liveOptions);
  } else if (mode === 'synthetic') {
    const pipeline = new PipelineService();
    registerApi(app, pipeline); registerStream(app, pipeline, origins);
    app.addHook('onClose', async () => pipeline.close());
  } else registerRecording(app, origins);
  return app;
}
