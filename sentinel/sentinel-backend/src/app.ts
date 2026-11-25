import Fastify from 'fastify';
import { registerApi } from './controllers/api.controller.js';
import { registerAuth } from './controllers/auth.controller.js';
import { registerStream } from './controllers/stream.controller.js';
import { PipelineService } from './services/pipeline.service.js';
import { registerReplayLibrary } from './recording/library.js';
import { registerRecording } from './recording/replay.js';
import { registerLive, type LiveOptions } from './live/service.js';
import { LiveCamera, registerCameraDetectionSettings, registerCameraFrames } from './live/camera.js';
import { registerVehicleDrive } from './vehicle/drive.js';
import { registerVehicleRisk, saveCameraCalibration } from './vehicle/service.js';

export function buildApp(mode = process.env['SOURCE_MODE'] ?? 'live', liveOptions: LiveOptions = {}) {
  const app = Fastify({ logger: false, bodyLimit: 2048, ajv: { customOptions: { removeAdditional: false } } });
  const origins = new Set((process.env['ALLOWED_ORIGINS'] ?? 'http://localhost:5173,http://127.0.0.1:5173,http://localhost:4173,http://127.0.0.1:4173').split(','));
  app.addHook('onRequest', async (request, reply) => {
    const origin = request.headers.origin;
    if (origin && !origins.has(origin)) return reply.code(403).send({ error: 'Origin forbidden' });
    if (origin) reply.header('Access-Control-Allow-Origin', origin).header('Vary', 'Origin');
    if (request.method === 'OPTIONS') return reply.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS').header('Access-Control-Allow-Headers', 'Content-Type').code(204).send();
  });
  registerAuth(app);
  if (mode === 'auth') return app;
  registerReplayLibrary(app);
  if (mode === 'live' || mode === 'vehicle') {
    const camera = new LiveCamera(liveOptions.camera);
    const readStationaryRadar = registerVehicleDrive(app, origins, process.env['SENTINEL_VEHICLE_PORT'] ?? 'COM11',
      (radar, speedMps) => readFusionRisk(radar, speedMps));
    const devicesFile = liveOptions.devicesFile ?? process.env['SENTINEL_DEVICES_FILE'] ?? process.env['SENTINEL_DEVICE_CONFIG_PATH'];
    const readFusionRisk = registerVehicleRisk(app, camera, undefined, { readStationaryRadar, editor: {
      origins,
      persist: settings => {
        if (!devicesFile) throw new Error('Missing device configuration path');
        saveCameraCalibration(devicesFile, settings);
      },
    } });
    registerCameraDetectionSettings(app, camera, origins);
    if (mode === 'live') registerLive(app, origins, liveOptions, camera);
    else {
      registerCameraFrames(app, camera);
      const recordingAvailable = registerRecording(app, origins, true);
      app.get('/api/health', async () => ({ source: 'vehicle', recordingAvailable }));
      app.addHook('onClose', async () => camera.close());
    }
  } else if (mode === 'synthetic') {
    const pipeline = new PipelineService();
    registerApi(app, pipeline); registerStream(app, pipeline, origins);
    app.addHook('onClose', async () => pipeline.close());
  } else registerRecording(app, origins);
  return app;
}
