import net from 'node:net';
import type { FastifyInstance } from 'fastify';
import { WebSocket, WebSocketServer } from 'ws';
import { Tcr300Decoder, type RadarObservation } from './tcr300.js';
import { LiveCamera, type CameraOptions } from './camera.js';
import { LiveRiskField } from './risk.js';

export interface LiveOptions { host?: string; port?: number; localAddress?: string; camera?:CameraOptions }
/** One hardware connection shared by clients. Browser pause does not stop acquisition. */
export class LiveRadar {
  private socket: net.Socket | undefined;
  private retry: ReturnType<typeof setTimeout> | undefined;
  private disposed = false;
  private decoder = new Tcr300Decoder();
  private latest = new Map<number, RadarObservation>();
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
    this.host = options.host ?? process.env['RADAR_HOST'] ?? '192.168.10.123';
    this.port = options.port ?? Number(process.env['RADAR_PORT'] ?? 50000);
    this.localAddress = options.localAddress ?? process.env['RADAR_BIND'];
    if (!Number.isInteger(this.port) || this.port < 1 || this.port > 65535) throw Error('Invalid RADAR_PORT');
    this.connect();
  }
  private connect() {
    if (this.disposed) return;
    this.state = 'connecting'; this.decoder.reset(); this.cycle = undefined; this.latest.clear();
    const socket = this.socket = net.createConnection({
      host: this.host, port: this.port, ...(this.localAddress ? { localAddress: this.localAddress } : {}),
    });
    socket.setNoDelay(true); socket.setTimeout(3000);
    socket.on('connect', () => { this.state = 'connected'; this.error = ''; });
    socket.on('data', chunk => {
      const now = Date.now(); this.bytes += chunk.length; this.lastPacketAt = now;
      for (const message of this.decoder.push(chunk)) {
        this.state = 'streaming'; this.error = '';
        if (message.type === 'cycle') {
          this.cycles++; this.lastCycleAt = now;
          this.cycle = { expected: message.count, observations: new Map() };
          if (message.count === 0) { this.latest.clear(); this.completeCycles++; }
        } else {
          const observation = { ...message.target, target_seq: ++this.targetCount, host_received_utc: new Date(now).toISOString() };
          this.latest.set(observation.track_id, observation);
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
          endpoint: `${this.host}:${this.port}`, bytes: this.bytes, cycles: this.cycles,
          completeCycles: this.completeCycles, totalTargets: this.targetCount,
          lastPacketAt: this.lastPacketAt, lastCycleAt: this.lastCycleAt,
          ageMs: this.lastCycleAt === null ? null : now - this.lastCycleAt, error: this.error },
        camera: { state: 'not-connected', message: '等待外接网络摄像头连接与 RTSP 地址' },
        fusion: { state: 'unavailable', message: '实时摄像头和本次现场标定未就绪，尚无融合风险场' },
      },
      context: { source: 'live', dispatchHz: 10, northCalibrated: false, radarRange: this.displayRange,
        bounds: { xMin: -50, xMax: 50, yMin: -20, yMax: 100 } },
    };
  }
  close() { this.disposed = true; clearTimeout(this.retry); this.socket?.destroy(); }
}

export function registerLive(app: FastifyInstance, origins: Set<string>, options: LiveOptions = {}) {
  const radar = new LiveRadar(options);
  const camera = new LiveCamera(options.camera);
  const risk = new LiveRiskField();
  const packet=()=>{
    const frame=radar.packet(), capture=camera.snapshot();
    const snapshot=frame.live.radar.state==='streaming'
      ? risk.snapshot(frame.radar,frame.live.radar.lastCycleAt,frame.timestamp) : null;
    return {...frame,snapshot,vision:capture.vision,context:{...frame.context,bounds:{...risk.bounds}},
      live:{...frame.live,camera:capture.status,
        fusion:{state:snapshot?'radar_only':'unavailable',
          message:snapshot?.message??'雷达数据未就绪或已过期，风险场暂不可用；联合标定尚未完成'}}};
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
  app.addHook('onClose', async () => { radar.close(); camera.close(); for (const client of clients) client.terminate(); await new Promise<void>(resolve => server.close(() => resolve())); });
}
