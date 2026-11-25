import Fastify from 'fastify';
import { registerApi } from './controllers/api.controller.js';
import { registerStream } from './controllers/stream.controller.js';
import { PipelineService } from './services/pipeline.service.js';
import { registerRecording } from './recording/replay.js';
import { registerLive, type LiveOptions } from './live/service.js';
import { registerVehicleRisk, saveCameraCalibration } from './vehicle/service.js';
import { registerVehicleDrive } from './vehicle/drive.js';
import { LiveCamera, registerCameraDetectionSettings, registerCameraFrames } from './live/camera.js';

export function buildApp(mode = process.env['SOURCE_MODE'] ?? 'recording', liveOptions: LiveOptions = {}) {
  const app = Fastify({ logger: false, bodyLimit: 2048, ajv: { customOptions: { removeAdditional: false } } });
  const origins = new Set((process.env['ALLOWED_ORIGINS'] ?? 'http://localhost:5173,http://127.0.0.1:5173,http://localhost:4173,http://127.0.0.1:4173').split(','));
  app.addHook('onRequest', async (request, reply) => {
    const origin = request.headers.origin;
    if (origin && !origins.has(origin)) return reply.code(403).send({ error: 'Origin forbidden' });
    if (origin) reply.header('Access-Control-Allow-Origin', origin).header('Vary', 'Origin');
    if (request.method === 'OPTIONS') return reply.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS').header('Access-Control-Allow-Headers', 'Content-Type').code(204).send();
  });
  const camera = mode === 'vehicle' || mode === 'live' ? new LiveCamera(liveOptions.camera) : undefined;
  const devicesPath = process.env['SENTINEL_DEVICE_CONFIG_PATH'];
  const readStationaryRadar = registerVehicleDrive(app, origins,
    mode === 'vehicle' ? process.env['SENTINEL_VEHICLE_PORT'] ?? 'COM11' : undefined);
  registerVehicleRisk(app, camera, undefined, mode === 'vehicle' ? {
    readStationaryRadar,
    editor: {
      origins,
      persist: settings => {
        if (!devicesPath) throw new Error('Missing device configuration path');
        saveCameraCalibration(devicesPath, settings);
      },
    },
  } : undefined);
  if (camera) {
    registerCameraFrames(app, camera);
    app.addHook('onClose', async () => camera.close());
    if (mode === 'vehicle') {
      registerCameraDetectionSettings(app, camera, origins);
      const recordingAvailable = registerRecording(app, origins, true);
      app.get('/api/health', async () => ({ source: 'vehicle', recordingAvailable }));
    }
    else registerLive(app, origins, camera, liveOptions);
  } else if (mode === 'synthetic') {
    const pipeline = new PipelineService();
    registerApi(app, pipeline); registerStream(app, pipeline, origins);
    app.addHook('onClose', async () => pipeline.close());
  } else registerRecording(app, origins);
  return app;
}
