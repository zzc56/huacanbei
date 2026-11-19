import { readFileSync, readdirSync, existsSync, statSync, createReadStream } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { WebSocket, WebSocketServer } from 'ws';
import type { FastifyInstance } from 'fastify';
import { VehicleAssociator, associationPolicy } from './vehicle-association.js';

type Row = Record<string, string>;
interface Snapshot extends Record<string, unknown> {
  observation_utc: string; host_utc: string; valid_until_utc: string;
  vision_sequence?: number; field_available: boolean;
  x_axis?: number[]; y_axis?: number[];
}
export function parseCsv(text: string): Row[] {
  const rows: string[][] = []; let row: string[] = [], value = '', quoted = false;
  text = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') { if (quoted && text[i + 1] === '"') { value += '"'; i++; } else quoted = !quoted; }
    else if (!quoted && (c === ',' || c === '\n')) {
      row.push(value.replace(/\r$/, '')); value = '';
      if (c === '\n') { rows.push(row); row = []; }
    } else value += c;
  }
  if (value || row.length) { row.push(value.replace(/\r$/, '')); rows.push(row); }
  const headers = rows.shift() ?? [];
  return rows.filter(r => r.length === headers.length).map(r => Object.fromEntries(headers.map((k, i) => [k, r[i] ?? ''])));
}
function floorIndex<T>(rows: T[], time: number, get: (row: T) => number): number {
  let lo = 0, hi = rows.length;
  while (lo < hi) { const mid = (lo + hi) >>> 1; if (get(rows[mid]!) <= time) lo = mid + 1; else hi = mid; }
  return lo - 1;
}
export class Recording {
  readonly frames: Row[]; readonly radar: Row[]; readonly snapshots: Snapshot[];
  readonly detections = new Map<number, Row[]>(); readonly bySequence = new Map<number, Row>();
  readonly byVisionSequence = new Map<number, Snapshot[]>();
  readonly start: number; readonly end: number; readonly manifest: Record<string, unknown>;
  readonly mediaRoot: string;
  readonly vehicleAssociator: VehicleAssociator;
  constructor(readonly root: string, mediaRoot?: string) {
    this.mediaRoot = mediaRoot ?? fileURLToPath(new URL('../../../media/', import.meta.url));
    const dirs = readdirSync(root, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => join(root, e.name));
    const vision = dirs.find(d => existsSync(join(d, 'frames.csv')));
    const radar = dirs.find(d => existsSync(join(d, 'targets.csv')));
    const fusion = dirs.find(d => existsSync(join(d, 'fusion.jsonl')));
    if (!vision || !radar || !fusion) throw new Error('RECORDING_DIR must contain vision, radar and fusion recording folders');
    this.frames = parseCsv(readFileSync(join(vision, 'frames.csv'), 'utf8')).sort((a, b) => Date.parse(a['captured_utc']!) - Date.parse(b['captured_utc']!));
    this.radar = parseCsv(readFileSync(join(radar, 'targets.csv'), 'utf8')).sort((a, b) => Date.parse(a['host_received_utc']!) - Date.parse(b['host_received_utc']!));
    this.snapshots = readFileSync(join(fusion, 'fusion.jsonl'), 'utf8').trim().split(/\r?\n/).map(line => JSON.parse(line) as Snapshot).map(s => Number.isFinite(Date.parse(s.observation_utc)) ? s : { ...s, observation_utc: s.host_utc }).sort((a, b) => Date.parse(a.observation_utc) - Date.parse(b.observation_utc) || Date.parse(a.host_utc) - Date.parse(b.host_utc));
    for(const snapshot of this.snapshots)if(snapshot.calibration_valid===true && Number.isFinite(snapshot.vision_sequence)){
      const sequence=Number(snapshot.vision_sequence),items=this.byVisionSequence.get(sequence)??[];
      items.push(snapshot);this.byVisionSequence.set(sequence,items);
    }
    for (const f of this.frames) this.bySequence.set(Number(f['sequence']), f);
    for (const d of parseCsv(readFileSync(join(vision, 'detections.csv'), 'utf8'))) {
      const seq = Number(d['sequence']); const items = this.detections.get(seq) ?? []; items.push(d); this.detections.set(seq, items);
    }
    this.vehicleAssociator=new VehicleAssociator(this.frames,this.detections,this.radar,this.snapshots);
    this.start = Date.parse(this.frames[0]!['captured_utc']!);
    this.end = Math.max(Date.parse(this.frames.at(-1)!['captured_utc']!), Date.parse(this.snapshots.at(-1)!.observation_utc));
    const axes = this.snapshots.filter(s => s.field_available && s.x_axis?.length && s.y_axis?.length);
    const bounds = { xMin: Math.min(-18, ...axes.map(s => s.x_axis![0]!)), xMax: Math.max(18, ...axes.map(s => s.x_axis!.at(-1)!)), yMin: Math.min(0, ...axes.map(s => s.y_axis![0]!)), yMax: Math.max(47, ...axes.map(s => s.y_axis!.at(-1)!)) };
    const radius = Math.ceil(Math.max(20, ...this.radar.map(r => Number(r['range']) || 0)) / 10) * 10;
    this.manifest = { schema: 'sentinel-recording-v1', source: 'recording', start: this.start, end: this.end, durationMs: this.end - this.start,
      dispatchHz: 10, counts: { video: this.frames.length, detections: [...this.detections.values()].reduce((n, r) => n + r.length, 0), radar: this.radar.length, fusion: this.snapshots.length, validFields: axes.length },
      camera: { width: Number(this.frames[0]!['width']), height: Number(this.frames[0]!['height']), annotated: true },
      videoUrl: existsSync(join(this.mediaRoot, 'recording.webm')) ? '/media/recording.webm' : null,
      imageTemplate: '/media/frames/{sequence}.jpg', bounds, radarRange: radius,
      coordinates: 'sensor-local', northCalibrated: false, riskModel: 'roadside-relative-risk-v2-coverage',
      vehicleAssociation:{method:'trajectory-geometry-v1',verifiedIdentity:false,policy:associationPolicy},
      timing: 'Host receive/decode UTC; replay, not a live sensor stream. MKV contains annotated sampled frames.',
    };
  }
  packet(timeMs: number) {
    const timestamp = Math.min(this.end, Math.max(this.start, this.start + timeMs));
    let snapshot: Snapshot | null = this.snapshots[floorIndex(this.snapshots, timestamp, r => Date.parse(r.observation_utc))] ?? null;
    if (snapshot && Date.parse(snapshot.valid_until_utc) < timestamp) snapshot = null;
    // Sensor observations have their own clocks. Fusion may lag, reject a class or be
    // unavailable; none of those conditions may suppress a real detection frame.
    const camera = this.frames[floorIndex(this.frames, timestamp, r => Date.parse(r['captured_utc']!))];
    const cameraValid = camera && timestamp - Date.parse(camera['captured_utc']!) <= 1500;
    // The current field can refer to a different vision frame. Recover identity and
    // motion only from an eligible snapshot for this exact image, never an adjacent frame.
    const candidates=cameraValid ? this.byVisionSequence.get(Number(camera['sequence']))??[] : [];
    const association=candidates.findLast(s=>Date.parse(s.observation_utc)<=timestamp && Date.parse(s.valid_until_utc)>=timestamp);
    const visionAssociation=association ? {vision_sequence:association.vision_sequence,observation_utc:association.observation_utc,
      valid_until_utc:association.valid_until_utc,calibration_valid:true,calibration:association.calibration,pedestrians:association.pedestrians} : null;
    const radarRows: Row[] = [];
    const seen = new Set<string>();
    for (let i = floorIndex(this.radar, timestamp, r => Date.parse(r['host_received_utc']!)); i >= 0; i--) {
      const row = this.radar[i]!;
      if (timestamp - Date.parse(row['host_received_utc']!) > 1500) break;
      if (!seen.has(row['track_id']!)) { seen.add(row['track_id']!); radarRows.push(row); }
    }
    return { type: 'recorded_frame', timestamp, snapshot, radar: radarRows,
      vision: cameraValid ? { ...camera, sequence: camera['sequence']!, captured_utc: camera['captured_utc']!, detections: this.detections.get(Number(camera['sequence'])) ?? [], association:visionAssociation,
        vehicleLinks:this.vehicleAssociator.frames.get(Number(camera['sequence']))??[],
        imageUrl: `/media/frames/${camera['sequence']}.jpg`, videoTimeSeconds: Math.ceil(Number(camera['video_pts_ms']) / 100) / 10 + 0.01 } : null,
      replay: { positionMs: timestamp - this.start, durationMs: this.end - this.start, ended: timestamp >= this.end },
      context: this.manifest,
    };
  }
}

export function registerRecording(app: FastifyInstance, origins: Set<string>) {
  const root = resolve(process.env['RECORDING_DIR'] ?? fileURLToPath(new URL('../../../../数据保存/', import.meta.url)));
  const recording = new Recording(root);
  const wss = new WebSocketServer({ noServer: true, maxPayload: 2048, perMessageDeflate: false });
  const clients = new Set<WebSocket>();
  app.get('/api/replay/manifest', async () => recording.manifest);
  app.get('/api/replay/associations', async () => recording.vehicleAssociator.report);
  app.get('/api/config', async () => ({ source: 'recording', sensorHz: 10, ...recording.manifest }));
  app.get('/api/health', async () => ({ state: 'ready', source: 'recording', clients: clients.size }));
  app.get<{ Querystring: { timeMs?: string } }>('/api/replay/frame', async (req, reply) => {
    const time = Number(req.query.timeMs ?? 0);
    if (!Number.isFinite(time) || time < 0) return reply.code(400).send({ error: 'Invalid timeMs' });
    return recording.packet(time);
  });
  app.get<{ Params: { '*': string } }>('/media/*', async (req, reply) => {
    const name = req.params['*'];
    if (!/^(recording\.webm|frames\/\d+\.jpg)$/.test(name)) return reply.code(404).send();
    const file = join(recording.mediaRoot, name);
    if (!existsSync(file)) return reply.code(404).send();
    const size = statSync(file).size, range = req.headers.range;
    reply.type(name.endsWith('.webm') ? 'video/webm' : 'image/jpeg').header('Accept-Ranges', 'bytes').header('Cache-Control', 'public,max-age=3600');
    if (range) {
      const m = /^bytes=(\d+)-(\d*)$/.exec(range);
      if (!m) return reply.code(416).header('Content-Range', `bytes */${size}`).send();
      const start = Number(m[1]), end = Math.min(size - 1, m[2] ? Number(m[2]) : size - 1);
      if (start >= size || end < start) return reply.code(416).header('Content-Range', `bytes */${size}`).send();
      return reply.code(206).header('Content-Range', `bytes ${start}-${end}/${size}`).header('Content-Length', end - start + 1).send(createReadStream(file, { start, end }));
    }
    return reply.header('Content-Length', size).send(createReadStream(file));
  });
  app.server.on('upgrade', (req, socket, head) => {
    if (req.url !== '/stream' || clients.size >= 32 || req.headers.origin && !origins.has(req.headers.origin)) { socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
  });
  wss.on('connection', (socket: WebSocket) => {
    clients.add(socket);
    let position = 0, anchor = performance.now(), playing = true, disposed = false;
    const send = (message: unknown) => { if (socket.readyState === WebSocket.OPEN && socket.bufferedAmount < 256 * 1024) socket.send(JSON.stringify(message)); };
    const total = () => recording.end - recording.start;
    const current = () => Math.min(total(), position + (playing ? performance.now() - anchor : 0));
    // 放到结尾就回到开头接着放，演示时不会停在一帧空画面上等人来点。
    const frame = () => {
      let time = current();
      if (playing && time >= total()) { position = 0; anchor = performance.now(); time = 0; }
      send(recording.packet(time));
    };
    send({ type: 'replay_manifest', ...recording.manifest }); frame();
    const timer = setInterval(() => { if (playing) frame(); }, 100);
    socket.on('message', (raw, binary) => {
      if (binary) return;
      try {
        const m = JSON.parse(raw.toString()) as { action?: string; positionMs?: number; targetId?: string };
        position = current(); anchor = performance.now();
        if (m.action === 'pause') playing = false;
        else if (m.action === 'play') { if (position >= recording.end - recording.start) position = 0; playing = true; }
        else if (m.action === 'seek' && Number.isFinite(m.positionMs)) position = Math.max(0, Math.min(recording.end - recording.start, m.positionMs!));
        else if (m.action === 'select_target') { send({ type: 'selection', targetId: m.targetId ?? null }); return; }
        else { send({ type: 'error', error: 'Invalid replay command' }); return; }
        frame(); send({ type: 'system_state', state: playing ? 'playing' : 'paused' });
      } catch { send({ type: 'error', error: 'Invalid JSON' }); }
    });
    const cleanup = () => { if (disposed) return; disposed = true; clearInterval(timer); clients.delete(socket); };
    socket.on('close', cleanup); socket.on('error', () => { cleanup(); socket.terminate(); });
  });
  app.addHook('onClose', async () => { for (const client of clients) client.terminate(); await new Promise<void>(done => wss.close(() => done())); });
}
