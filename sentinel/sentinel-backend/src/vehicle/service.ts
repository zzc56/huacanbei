import { randomUUID } from 'node:crypto';
import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import type { ServerResponse } from 'node:http';
import type { FastifyInstance } from 'fastify';
import { Ajv } from 'ajv';
import { evaluateVehicleRisk, vehicleLimits, type VehicleFrame } from './risk.js';
import type { CameraFrameStore } from '../live/camera.js';
import { radarTrialSettings, type StationaryFusionState, type StationaryPose, type StockLidarPreview, type StockLidarSample } from './contracts.js';
import { prepareCalibration, projectedCameraPreview, type CalibrationSettings, type LiveCalibration } from './ground-calibration.js';

interface CalibrationEditor {
  origins: ReadonlySet<string>;
  persist(settings: CalibrationSettings): void;
}

interface VehicleRiskOptions {
  editor?: CalibrationEditor;
  readStationaryRadar?(stationaryId: string): {sinceMs:number; scans:readonly StockLidarSample[]} | null;
}

export function saveCameraCalibration(path: string, calibration: CalibrationSettings) {
  const config = JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
  if (!config?.camera || typeof config.camera !== 'object' || Array.isArray(config.camera))
    throw new Error('Missing camera configuration');
  config.camera.groundCalibration = calibration;
  const temporaryPath = path + '.' + randomUUID() + '.tmp';
  try {
    writeFileSync(temporaryPath, JSON.stringify(config, null, 2) + '\n', {flag:'wx', mode:0o600});
    renameSync(temporaryPath, path);
  } finally {
    rmSync(temporaryPath, {force:true});
  }
}

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

function sensorSchema(items: typeof point | typeof scanPoint, maxItems: number, camera = false) {
  const tracked = { ...items, properties: { ...items.properties, trackId: {type:'string', pattern:'^[a-zA-Z0-9_-]{1,40}$'} } };
  return { anyOf: [{
    type: 'object', additionalProperties: false, required: ['capturedAtMs', 'observations'],
    properties: { capturedAtMs: time, observations: { type: 'array', maxItems, items: tracked },
      ...(camera ? { sequence: { type:'integer', minimum:1, maximum:Number.MAX_SAFE_INTEGER } } : {}) },
  }, { type: 'null' }] };
}

export function registerVehicleRisk(app: FastifyInstance, camera?: CameraFrameStore,
                                    calibrationSettings = process.env['CAMERA_GROUND_CALIBRATION'],
                                    {editor, readStationaryRadar}: VehicleRiskOptions = {}) {
  let latest: VehicleFrame | null = null;
  let drivePose: VehicleFrame['pose'] | undefined;
  let calibration: LiveCalibration | undefined;
  if (camera && calibrationSettings) {
    try { calibration = prepareCalibration(JSON.parse(calibrationSettings)); }
    catch { app.log.warn('Invalid local camera ground calibration'); }
  }
  function current(now: number) {
    const result = evaluateVehicleRisk(latest, now);
    if (camera) {
      const capture = camera.vehicleSnapshot(now);
      result.observations.camera ??= projectedCameraPreview(capture, calibration, now, vehicleLimits.maxAgeMs);
      result.capture = camera.displaySnapshot(capture, now);
    }
    return result;
  }
  app.get('/api/vehicle/frame', async (_request, reply) => {
    reply.header('Cache-Control', 'no-store');
    return current(Date.now());
  });
  if (camera) {
    const streams = new Set<ServerResponse>();
    app.addHook('preClose', async () => {
      for (const stream of streams) stream.end();
    });
    app.get('/api/vehicle/camera-stream', (_request, reply) => {
      reply.hijack();
      const response = reply.raw;
      const origin = reply.getHeader('access-control-allow-origin');
      if (typeof origin === 'string') {
        response.setHeader('Access-Control-Allow-Origin', origin);
        response.setHeader('Vary', 'Origin');
      }
      response.writeHead(200, {
        'Content-Type':'text/event-stream; charset=utf-8',
        'Cache-Control':'no-store, no-transform',
        'X-Accel-Buffering':'no',
      });
      streams.add(response);
      let lastSent = 0;
      function send() {
        if (response.destroyed || response.writableEnded || response.writableNeedDrain) return;
        lastSent = Date.now();
        response.write('data: ' + JSON.stringify(current(lastSent)) + '\n\n');
      }
      const unsubscribe = camera.onFrame(send);
      const heartbeat = setInterval(() => {
        if (Date.now() - lastSent >= 500) send();
      }, 500);
      response.once('close', () => {
        streams.delete(response);
        unsubscribe();
        clearInterval(heartbeat);
      });
      send();
    });
  }
  app.get('/api/vehicle/config', async () => vehicleLimits);
  if (camera && readStationaryRadar) {
    app.get<{ Querystring: StationaryPose }>('/api/vehicle/stationary-fusion', {
      schema:{querystring:{
        type:'object', required:['xM','yM','headingDeg','stationaryId'], additionalProperties:false,
        properties:{...point.properties, headingDeg:angle, stationaryId:{type:'string', minLength:36, maxLength:36}},
      }},
    }, (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      const {xM, yM, headingDeg, stationaryId} = request.query;
      const telemetry = readStationaryRadar(stationaryId), now = Date.now();
      const capture = camera.vehicleSnapshot(now);
      const projected = projectedCameraPreview(capture, calibration, now, vehicleLimits.maxAgeMs);
      const cutoff = Math.max(telemetry?.sinceMs ?? now, now - vehicleLimits.maxAgeMs);
      const scans = telemetry?.scans
        .filter(scan=>scan.receivedAtMs >= cutoff && scan.receivedAtMs <= now)
        .map(scan=>({capturedAtMs:scan.receivedAtMs, observations:scan.observations})) ?? [];
      const sameResolution = calibration && capture.vision?.width === calibration.settings.width &&
        capture.vision.height === calibration.settings.height;
      const projections = sameResolution && capture.status.detector !== '未启用'
        ? camera.snapshotsSince(cutoff, now).flatMap(frame=>{
            const sample = frame.vision?.sequence === capture.vision?.sequence
              ? projected : projectedCameraPreview(frame, calibration, now, vehicleLimits.maxAgeMs);
            return sample ? [{frame,sample}] : [];
          })
        : [];
      const preview = projections[0];
      const display = camera.displaySnapshot(preview?.frame ?? capture, now);
      for (const {sample} of projections) {
        const lidar = scans.find(scan=>Math.abs(scan.capturedAtMs - sample.capturedAtMs) <= vehicleLimits.maxSkewMs);
        if (!lidar) continue;
        const pose = {xM,yM,headingDeg,speedMps:0,capturedAtMs:lidar.capturedAtMs};
        return {...evaluateVehicleRisk({pose,camera:sample,lidar}, now), capture:display, stationaryFusion:'aligned'};
      }
      const stationaryFusion: StationaryFusionState = !telemetry ? 'waiting_for_pose' : !scans.length ? 'waiting_for_radar' :
        !preview ? 'waiting_for_camera' : 'waiting_for_sync';
      const result = evaluateVehicleRisk(null, now);
      result.observations.camera = preview?.sample ?? projected;
      result.observations.lidar = scans[0] ? {...scans[0],includedInFusion:false} : null;
      return {...result,capture:display,stationaryFusion};
    });
  }
  if (camera && editor) {
    app.post<{ Body: Partial<CalibrationSettings> }>('/api/vehicle/calibration', {bodyLimit:4096}, (request, reply) => {
      const origin = request.headers.origin;
      const local = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(request.ip);
      if (!local || !origin || !editor.origins.has(origin))
        return reply.code(403).send({error:'请从本机车路协同网页保存标定。'});
      const vision = camera.vehicleSnapshot().vision;
      if (!vision) return reply.code(409).send({error:'监控画面已断开，请接通后重新取帧。'});
      const {width, height, points} = request.body ?? {};
      if (width !== vision.width || height !== vision.height)
        return reply.code(409).send({error:'监控画面尺寸已变化，请重新取帧。'});
      let updated: LiveCalibration;
      try {
        updated = prepareCalibration({
          width, height, points,
          cameraOffsetMs:calibration?.settings.cameraOffsetMs ?? 0,
          alignmentWindowMs:calibration?.settings.alignmentWindowMs ?? vehicleLimits.maxSkewMs,
        });
      } catch (error) {
        return reply.code(400).send({error:error instanceof Error ? error.message : '地面标定参数无效。'});
      }
      try { editor.persist(updated.settings); }
      catch {
        app.log.error('Failed to save local camera calibration');
        return reply.code(500).send({error:'保存失败，请检查车路协同后端是否通过启动脚本运行，以及本机设备配置是否可写。'});
      }
      calibration = updated;
      return {saved:true};
    });
  }
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
        camera: sensorSchema(point, 32, true),
        lidar: sensorSchema(scanPoint, 64),
      },
    } },
  }, async (request, reply) => {
    const frame = request.body, now = Date.now();
    for (const sample of [frame.camera, frame.lidar]) {
      const ids = sample?.observations.flatMap(p => p.trackId ? [p.trackId] : []) ?? [];
      if (new Set(ids).size !== ids.length) return reply.code(400).send({ error:'单路同帧的跟踪编号必须唯一' });
    }
    if ([frame.pose, frame.camera, frame.lidar].some(sample => sample && sample.capturedAtMs > now)) {
      return reply.code(400).send({ error: '观测时间超前' });
    }
    if (latest && frame.pose.capturedAtMs < latest.pose.capturedAtMs) {
      return reply.code(409).send({ error: '已接收更新的位姿' });
    }
    latest = frame;
    if (['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(request.ip))
      drivePose = frame.pose;
    return current(now);
  });

  return (radar: StockLidarPreview, speedMps: number) => {
    const pose = drivePose, scan = radar.sample, now = Date.now();
    const {maxAgeMs, maxSkewMs} = vehicleLimits;
    if (!camera || !calibration || !pose || !scan || radar.status !== 'online' ||
        now - pose.capturedAtMs > maxAgeMs || now - scan.receivedAtMs > maxAgeMs ||
        Math.abs(scan.receivedAtMs - pose.capturedAtMs) > maxSkewMs) return null;
    const lidar = {capturedAtMs:scan.receivedAtMs, observations:scan.observations};
    const cutoff = Math.max(now - maxAgeMs, lidar.capturedAtMs - maxSkewMs, pose.capturedAtMs - maxSkewMs);
    for (const capture of camera.snapshotsSince(cutoff, now)) {
      const vision = projectedCameraPreview(capture, calibration, now, maxAgeMs);
      if (!vision || Math.abs(vision.capturedAtMs - lidar.capturedAtMs) > maxSkewMs ||
          Math.abs(vision.capturedAtMs - pose.capturedAtMs) > maxSkewMs) continue;
      const result = evaluateVehicleRisk({pose:{...pose,speedMps},camera:vision,lidar}, now,
        undefined, true, radarTrialSettings.stopDistanceM);
      if (result.observations.camera?.includedInFusion) return { ...result, capture:camera.displaySnapshot(capture, now) };
    }
    return null;
  };
}
