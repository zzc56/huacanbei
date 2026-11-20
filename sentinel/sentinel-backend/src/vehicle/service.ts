import type { FastifyInstance } from 'fastify';
import { Ajv } from 'ajv';
import { evaluateVehicleRisk, vehicleLimits, type VehicleFrame } from './risk.js';
import { buildVehicleDemo } from './demo.js';

const time = { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER };
const coordinate = { type: 'number', minimum: -1000, maximum: 1000 };
const angle = { type: 'number', minimum: -360, maximum: 360 };
// Vehicle observations are JSON numbers in metres and milliseconds. Reject missing
// or malformed values instead of coercing e.g. null to a zero coordinate.
const bodyValidator = new Ajv({ coerceTypes: false });
const point = {
  type: 'object', additionalProperties: false, required: ['xM', 'yM'],
  properties: { xM: coordinate, yM: coordinate },
};
const scanPoint = {
  type: 'object', additionalProperties: false, required: ['rangeM', 'bearingDeg'],
  properties: { rangeM: { type: 'number', exclusiveMinimum: 0, maximum: 20 }, bearingDeg: angle },
};

function sensorSchema(items: typeof point | typeof scanPoint, maxItems: number) {
  return { anyOf: [{
    type: 'object', additionalProperties: false, required: ['capturedAtMs', 'observations'],
    properties: { capturedAtMs: time, observations: { type: 'array', maxItems, items } },
  }, { type: 'null' }] };
}

export function registerVehicleRisk(app: FastifyInstance): void {
  let latest: VehicleFrame | null = null;
  let demo: ReturnType<typeof buildVehicleDemo> | undefined;
  app.get('/api/vehicle/frame', async (_request, reply) => {
    reply.header('Cache-Control', 'no-store');
    return evaluateVehicleRisk(latest, Date.now());
  });
  app.get<{ Params: { step: string } }>('/api/vehicle/demo/:step', async (request, reply) => {
    demo ??= buildVehicleDemo();
    const step = Number(request.params.step);
    const frame = demo.frames[step];
    if (!/^\d+$/.test(request.params.step) || !frame) return reply.code(400).send({ error: '无效的演示帧' });
    return { ...evaluateVehicleRisk(frame, frame.pose.capturedAtMs), step, stages: demo.stages,
      lastStep: demo.frames.length - 1, tickMs: demo.tickMs };
  });
  app.get('/api/vehicle/config', async () => vehicleLimits);
  app.post<{ Body: VehicleFrame }>('/api/vehicle/risk', {
    bodyLimit: 32768,
    validatorCompiler: ({ schema }) => bodyValidator.compile(schema),
    schema: { body: {
      type: 'object', additionalProperties: false, required: ['pose', 'camera', 'lidar'],
      properties: {
        pose: {
          type: 'object', additionalProperties: false,
          required: ['xM', 'yM', 'headingDeg', 'speedMps', 'capturedAtMs'],
          properties: { ...point.properties, headingDeg: angle, capturedAtMs: time,
            speedMps: { type: 'number', minimum: 0, maximum: 2 } },
        },
        camera: sensorSchema(point, 32),
        lidar: sensorSchema(scanPoint, 64),
      },
    } },
  }, async (request, reply) => {
    const frame = request.body, now = Date.now();
    if ([frame.pose, frame.camera, frame.lidar].some(sample => sample && sample.capturedAtMs > now)) {
      return reply.code(400).send({ error: '观测时间超前' });
    }
    if (latest && frame.pose.capturedAtMs < latest.pose.capturedAtMs) {
      return reply.code(409).send({ error: '已接收更新的位姿' });
    }
    latest = frame;
    return evaluateVehicleRisk(frame, now);
  });
}
