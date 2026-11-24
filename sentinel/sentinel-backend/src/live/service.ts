import net from 'node:net';
import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { WebSocket, WebSocketServer } from 'ws';
import { Tcr300Decoder, type RadarObservation } from './tcr300.js';
import { LiveCamera, type CameraOptions } from './camera.js';
import { LiveRiskField } from './risk.js';
import { devicesPath, parseRadarSettings, readDeviceConfig, updateDeviceConfig } from './radar-settings.js';
import { prepareCalibration, type LiveCalibration } from './calibration.js';
import { LiveVehicleMatcher, RadarTimeline } from './vehicle-matching.js';

export interface LiveOptions { host?: string; port?: number; localAddress?: string; camera?:CameraOptions; devicesFile?: string }
/** One hardware connection shared by clients. Browser pause does not stop acquisition. */
export class LiveRadar {
  private socket: net.Socket | undefined;
  private retry: ReturnType<typeof setTimeout> | undefined;
  private disposed = false;
  private decoder = new Tcr300Decoder();
  private latest = new Map<number, RadarObservation>();
  readonly timeline = new RadarTimeline();
  private cycle: { expected: number; observations: Map<number, RadarObservation> } | undefined;
  private state = 'connecting';
  private error = '';
  private bytes = 0;
  private cycles = 0;
  private completeCycles = 0;
  private targetCount = 0;
  private displayRange = 200;
  private lastPacketAt: number | null = null;
  private lastCycleAt: number | null = null;
  private readonly startedAt = Date.now();
  readonly host: string;
  readonly port: number;
  readonly localAddress: string | undefined;
  constructor(options: LiveOptions = {}) {
    this.host = options.host ?? process.env['RADAR_HOST'] ?? '';
    this.port = options.port ?? Number(process.env['RADAR_PORT'] ?? 50000);
    this.localAddress = options.localAddress ?? process.env['RADAR_BIND'];
    if (!Number.isInteger(this.port) || this.port < 1 || this.port > 65535) throw Error('Invalid RADAR_PORT');
    if (this.host) this.connect();
    else this.state = 'unconfigured';
  }
  private connect() {
    if (this.disposed) return;
    this.state = 'connecting'; this.decoder.reset(); this.cycle = undefined; this.latest.clear(); this.timeline.clear(); this.lastCycleAt = null;
    const socket = this.socket = net.createConnection({
      host: this.host, port: this.port, ...(this.localAddress ? { localAddress: this.localAddress } : {}),
    });
    socket.setNoDelay(true); socket.setTimeout(3000);
    socket.on('connect', () => { this.state = 'awaiting-data'; this.error = ''; });
    socket.on('data', chunk => {
      const now = Date.now(); this.bytes += chunk.length; this.lastPacketAt = now;
      for (const message of this.decoder.push(chunk)) {
        if (message.type === 'cycle') {
          this.state = 'streaming'; this.error = '';
          this.cycles++; this.lastCycleAt = now;
          this.cycle = { expected: message.count, observations: new Map() };
          if (message.count === 0) { this.latest.clear(); this.completeCycles++; }
        } else {
          const previous = this.latest.get(message.target.track_id);
          const sequence = ++this.targetCount;
          const trackStart = previous && now - Date.parse(previous.host_received_utc) <= 1500
            ? previous.track_start_seq ?? previous.target_seq : sequence;
          const observation: RadarObservation = {
            ...message.target, target_seq: sequence, track_start_seq: trackStart, host_received_utc: new Date(now).toISOString(),
          };
          this.latest.set(observation.track_id, observation);
          this.timeline.record(observation, now);
          this.displayRange = Math.max(this.displayRange, Math.ceil(observation.range / 50) * 50);
          if (this.cycle) {
            this.cycle.observations.set(observation.track_id, observation);
            if (this.cycle.expected > 0 && this.cycle.observations.size === this.cycle.expected) {
              this.latest = new Map(this.cycle.observations); this.completeCycles++; this.cycle = undefined;
            }
          }
        }
      }
    });
    socket.on('timeout', () => { this.error = '3 秒内未收到雷达数据'; socket.destroy(); });
    socket.on('error', (error: NodeJS.ErrnoException) => { this.error = error.code ?? 'TCP connection error'; });
    socket.on('close', () => {
      this.state = 'disconnected'; this.latest.clear(); this.cycle = undefined;
      if (!this.disposed) this.retry = setTimeout(() => this.connect(), 1000);
    });
  }
  packet(now = Date.now()) {
    const radar = [...this.latest.values()].filter(r => now - Date.parse(r.host_received_utc) <= 1500);
    const streamFresh = this.lastCycleAt !== null && now - this.lastCycleAt <= 1500;
    return {
      type: 'live_frame', timestamp: now, radar: streamFresh ? radar : [], vision: null, snapshot: null,
      live: {
        startedAt: this.startedAt,
        radar: { state: this.state === 'streaming' && !streamFresh ? 'stale' : this.state,
          endpoint: this.host ? `${this.host}:${this.port}` : '', bytes: this.bytes, cycles: this.cycles,
          completeCycles: this.completeCycles, totalTargets: this.targetCount,
          lastPacketAt: this.lastPacketAt, lastCycleAt: this.lastCycleAt,
          ageMs: this.lastCycleAt === null ? null : now - this.lastCycleAt, error: this.error },
        camera: { state: 'not-connected', message: '等待外接网络摄像头连接与 RTSP 地址' },
        fusion: { state: 'unavailable', message: '等待实时雷达数据' },
      },
      context: { source: 'live', dispatchHz: 10, northCalibrated: false, radarRange: this.displayRange,
        bounds: { xMin: -50, xMax: 50, yMin: -20, yMax: 100 } },
    };
  }
  close() { this.disposed = true; clearTimeout(this.retry); this.socket?.destroy(); }
}

export function registerLive(app: FastifyInstance, origins: Set<string>, options: LiveOptions) {
  const devicesFile = options.devicesFile ?? process.env['SENTINEL_DEVICES_FILE'] ?? devicesPath;
  const deviceConfig = readDeviceConfig(devicesFile);
  const initialRadar = deviceConfig.radar?.host === '' ? deviceConfig.radar : parseRadarSettings(deviceConfig.radar);
  let radar = new LiveRadar({ ...initialRadar, ...options });
  const camera = new LiveCamera(options.camera);
  let risk = new LiveRiskField();
  const matcher = new LiveVehicleMatcher();
  let savingSettings = false;
  const settings = () => ({ host: radar.host, port: radar.port, localAddress: radar.localAddress ?? '' });
  const deviceKey = () => createHash('sha256').update(JSON.stringify([settings(), options.camera?.url ?? process.env['CAMERA_RTSP_URL'] ?? ''])).digest('hex');
  let calibration: LiveCalibration | undefined;
  const stored = deviceConfig.calibration as { deviceKey?: string; settings?: unknown } | undefined;
  if (stored?.deviceKey === deviceKey()) {
    try { calibration = prepareCalibration(stored.settings); }
    catch { app.log.warn('Ignoring an invalid stored radar-camera calibration'); }
  }
  const cameraDelay = () => Math.max(0, -(calibration?.settings.cameraOffsetMs ?? 0));
  camera.setAlignmentDelay(cameraDelay());
  const calibrationState = () => ({ calibration: calibration ? {
    settings: calibration.settings, rmsErrorM: calibration.rmsErrorM, maxErrorM: calibration.maxErrorM,
  } : null });
  const requireLocal = async (request: FastifyRequest, reply: FastifyReply) => {
    reply.header('Cache-Control', 'no-store');
    if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(request.ip)) {
      return reply.code(403).send({ message: '请在运行雷达服务的本机修改设备设置' });
    }
  };
  app.get('/api/live/radar-settings', { preHandler: requireLocal }, async () => settings());
  app.post('/api/live/radar-settings', { preHandler: requireLocal }, async (request, reply) => {
    const next = parseRadarSettings(request.body);
    if (!next) return reply.code(400).send({ message: '请输入有效的 IPv4 地址和 1–65535 的端口' });
    if (savingSettings) return reply.code(409).send({ message: '正在应用另一项设备设置，请稍后重试' });
    savingSettings = true;
    try {
      const old = settings();
      const deviceChanged = old.host !== next.host || old.port !== next.port || old.localAddress !== next.localAddress;
      await updateDeviceConfig(devicesFile, config => {
        config.radar = { ...config.radar, ...next };
        if (deviceChanged) delete config.calibration;
      });
      const previous = radar;
      radar = new LiveRadar(next);
      risk = new LiveRiskField();
      matcher.reset();
      if (deviceChanged) {
        calibration = undefined;
        camera.setAlignmentDelay(0);
      }
      previous.close();
      return settings();
    } catch (error) {
      request.log.error(error, 'Unable to save radar settings');
      return reply.code(500).send({ message: '雷达设置无法保存，请检查本机配置文件权限' });
    } finally {
      savingSettings = false;
    }
  });
  app.get('/api/live/calibration', { preHandler: requireLocal }, async () => calibrationState());
  app.get<{ Querystring: { sequence?: string; offset?: string; window?: string } }>(
    '/api/live/calibration/observations', { preHandler: requireLocal }, async (request, reply) => {
      const { sequence, offset, window } = request.query;
      const frameId = Number(sequence), offsetMs = Number(offset), windowMs = Number(window);
      if (!Number.isSafeInteger(frameId) || frameId < 1 || !offset || !Number.isFinite(offsetMs) || Math.abs(offsetMs) > 5000 ||
        !Number.isFinite(windowMs) || windowMs < 20 || windowMs > 500) {
        return reply.code(400).send({ message: '请选择有效画面和时间对齐参数' });
      }
      const capturedAt = camera.capturedAt(frameId);
      if (capturedAt === undefined) return reply.code(404).send({ message: '画面已过期，请重新冻结' });
      const frame = radar.packet();
      return { observations: radar.timeline.align(frame.radar, capturedAt - offsetMs, windowMs, false) };
    });
  app.post('/api/live/calibration', { bodyLimit: 8192, preHandler: requireLocal }, async (request, reply) => {
    if (savingSettings) return reply.code(409).send({ message: '正在应用另一项设备设置，请稍后重试' });
    savingSettings = true;
    try {
      let next: LiveCalibration;
      try { next = prepareCalibration(request.body); }
      catch (error) { return reply.code(400).send({ message: (error as Error).message }); }
      const vision = camera.snapshot().vision;
      if (vision && (vision.width !== next.settings.width || vision.height !== next.settings.height)) {
        return reply.code(400).send({ message: '标定尺寸与当前实时画面不一致，请重新冻结画面' });
      }
      await updateDeviceConfig(devicesFile, (config, isNew) => {
        if (isNew) config.radar = { ...config.radar, ...settings() };
        config.calibration = { deviceKey: deviceKey(), settings: next.settings };
      });
      calibration = next;
      camera.setAlignmentDelay(cameraDelay());
      matcher.reset();
      return calibrationState();
    } catch (error) {
      request.log.error(error, 'Unable to save radar-camera calibration');
      return reply.code(500).send({ message: '无法保存标定，请检查本机配置文件权限' });
    } finally { savingSettings = false; }
  });
  const packet=()=>{
    const frame=radar.packet(), capture=camera.snapshot(frame.timestamp);
    const snapshot=frame.live.radar.state==='streaming'
      ? risk.snapshot(frame.radar,frame.live.radar.lastCycleAt,frame.timestamp) : null;
    const newest = capture.vision;
    const sizeMismatch = !!(calibration && newest && (newest.width !== calibration.settings.width || newest.height !== calibration.settings.height));
    const devicesOnline = !!(newest && capture.status.state === 'streaming' && frame.live.radar.state === 'streaming');
    const devicesReady = !!(calibration && !sizeMismatch && devicesOnline && capture.status.detector !== '未启用');
    // A negative offset needs later radar packets. Hold the corresponding video frame until they can arrive.
    const delayMs = devicesReady ? cameraDelay() : 0;
    const delayed = delayMs > 0 ? camera.snapshot(frame.timestamp, delayMs).vision : newest;
    const video = delayed?.width === newest?.width && delayed?.height === newest?.height ? delayed : null;
    const active = devicesReady && !!video;
    if (!active) matcher.reset();
    const vehicleLinks = active && video && calibration ? matcher.match(video, frame.radar, radar.timeline, calibration, frame.timestamp) : [];
    const association = {
      state: !calibration ? 'unconfigured' : sizeMismatch ? 'resolution-mismatch' : active ? 'active' : 'waiting',
      count: vehicleLinks.length,
      message: !calibration ? '请完成雷视标定'
        : sizeMismatch ? '视频分辨率变化，请重新标定'
        : !devicesOnline ? '等待雷达与摄像头数据'
        : !devicesReady ? '摄像头目标检测未启用'
        : active ? '实时雷视匹配' : '正在缓存画面以对齐雷达',
    };
    const display = video ?? newest;
    return {...frame,snapshot,vision:display ? { ...display, alignmentDelayMs: video ? delayMs : 0, vehicleLinks } : null,context:{...frame.context,bounds:{...risk.bounds}},
      live:{...frame.live,camera:capture.status,
        association,
        fusion:{state:snapshot?'radar_only':'unavailable',
          message:snapshot ? '实时风险场由雷达点迹和运动量计算' : '雷达数据未就绪或已过期，风险场暂不可用'}}};
  };
  const server = new WebSocketServer({ noServer: true, maxPayload: 2048, perMessageDeflate: false });
  const clients = new Set<WebSocket>();
  app.get('/api/config', async () => packet().context);
  app.get('/api/health', async () => ({ source: 'live', state: packet().live.radar.state, clients: clients.size }));
  app.get('/api/live/status', async () => packet().live);
  app.get('/api/live/frame', async () => packet());
  app.get<{Params:{sequence:string}}>('/api/live/camera/:sequence.jpg',async(request,reply)=>{
    const jpeg=camera.image(Number(request.params.sequence));
    if(!jpeg)return reply.code(404).send({error:'Camera frame expired or unavailable'});
    return reply.header('Cache-Control','no-store').type('image/jpeg').send(jpeg);
  });
  app.server.on('upgrade', (req, socket, head) => {
    if (req.url !== '/stream' || clients.size >= 32 || req.headers.origin && !origins.has(req.headers.origin)) { socket.destroy(); return; }
    server.handleUpgrade(req, socket, head, ws => server.emit('connection', ws, req));
  });
  server.on('connection', (socket: WebSocket) => {
    clients.add(socket); let paused = false, lastSentAt = 0;
    const send = (value: unknown) => { if (socket.readyState === WebSocket.OPEN && socket.bufferedAmount < 256 * 1024) socket.send(JSON.stringify(value)); };
    const sendFrame = () => {
      // A slow client skips frames; it must not build a queue of old pictures.
      if(socket.readyState!==WebSocket.OPEN||socket.bufferedAmount>0)return;
      send(packet());lastSentAt=Date.now();
    };
    send({ type: 'live_manifest', ...packet().context }); sendFrame();
    // Publish each camera result immediately, keeping the JPEG and its boxes paired.
    // The timer still updates radar/status when the camera is quiet.
    const unsubscribeCamera = camera.onFrame(()=>{if(!paused)sendFrame();});
    const timer = setInterval(() => { if (!paused && Date.now()-lastSentAt>=90) sendFrame(); }, 100);
    socket.on('message', (raw, binary) => {
      if (binary) return;
      try {
        const m = JSON.parse(raw.toString()) as { action?: string; targetId?: string };
        if (m.action === 'pause' || m.action === 'play') {
          paused = m.action === 'pause'; send({ type: 'system_state', state: paused ? 'paused' : 'playing' }); send(packet());
        } else if (m.action === 'select_target') send({ type: 'selection', targetId: m.targetId ?? null });
        else send({ type: 'error', error: 'Unsupported live command' });
      } catch { send({ type: 'error', error: 'Invalid JSON' }); }
    });
    socket.on('error', () => socket.terminate());
    socket.on('close', () => { clearInterval(timer); unsubscribeCamera(); clients.delete(socket); });
  });
  app.addHook('preClose', async () => {
    for (const client of clients) client.terminate();
    await new Promise<void>(resolve => server.close(() => resolve()));
  });
  app.addHook('onClose', async () => { radar.close(); camera.close(); });
}
