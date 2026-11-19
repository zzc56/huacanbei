import type { FastifyInstance } from 'fastify';
import { config } from '../config.js';
import type { ControlAction } from '../contracts.js';
import type { PipelineService } from '../services/pipeline.service.js';

export function registerApi(app: FastifyInstance, pipeline: PipelineService): void {
  app.get('/api/config', async () => ({ ...config, state: pipeline.state }));
  app.get('/api/health', async (_request, reply) => {
    if (pipeline.state === 'failed') reply.code(503);
    return { state: pipeline.state, lastFrameTimestamp: pipeline.latest?.frame.timestamp ?? null };
  });
  app.post<{ Body: { action: ControlAction } }>('/api/control', {
    schema: { body: { type: 'object', required: ['action'], additionalProperties: false, properties: { action: { type: 'string', enum: ['play', 'pause', 'reset'] } } } },
  }, async (request, reply) => {
    try { return { state: await pipeline.control(request.body.action) }; }
    catch { return reply.code(503).send({ error: 'Pipeline unavailable or control queue busy' }); }
  });
  app.get<{ Querystring: { from?: number; to?: number; limit?: number } }>('/api/history', {
    schema: { querystring: { type: 'object', additionalProperties: false, properties: { from: { type: 'number', minimum: 0 }, to: { type: 'number', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 20, default: 20 } } } },
  }, async (request, reply) => {
    const { from = 0, to = Date.now(), limit = 20 } = request.query;
    if (from > to) return reply.code(400).send({ error: 'from must be <= to' });
    return { frames: pipeline.query(from, to, limit), retentionFrames: config.historyCapacity, includesRiskField: false };
  });
}
