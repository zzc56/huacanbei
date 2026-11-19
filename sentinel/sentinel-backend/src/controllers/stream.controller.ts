import { WebSocket, WebSocketServer } from 'ws';
import type { FastifyInstance } from 'fastify';
import { config } from '../config.js';
import type { PipelineService } from '../services/pipeline.service.js';

interface ClientState { selected: string | null; alive: boolean; congested: number; lastCommand: number }
function selection(value: unknown): value is { action: 'select_target'; targetId: string | null } {
  if (typeof value !== 'object' || value === null || !('action' in value) || !('targetId' in value)) return false;
  return value.action === 'select_target' && (value.targetId === null || typeof value.targetId === 'string' && /^T\d{1,12}$/.test(value.targetId));
}
export function registerStream(app: FastifyInstance, pipeline: PipelineService, allowedOrigins: ReadonlySet<string>): void {
  const server = new WebSocketServer({ noServer: true, maxPayload: 1024, perMessageDeflate: false });
  const clients = new Map<WebSocket, ClientState>();
  const send = (socket: WebSocket, text: string): void => {
    if (socket.readyState !== WebSocket.OPEN) return;
    if (Buffer.byteLength(text) > config.maxFrameBytes || socket.bufferedAmount + Buffer.byteLength(text) > config.maxBufferedBytes) return;
    socket.send(text, error => { if (error) socket.terminate(); });
  };
  app.server.on('upgrade', (request, socket, head) => {
    const origin = request.headers.origin;
    if (request.url !== '/stream' || clients.size >= 128 || (origin !== undefined && !allowedOrigins.has(origin))) { socket.destroy(); return; }
    server.handleUpgrade(request, socket, head, ws => server.emit('connection', ws, request));
  });
  server.on('connection', (socket: WebSocket) => {
    const state: ClientState = { selected: null, alive: true, congested: 0, lastCommand: 0 };
    clients.set(socket, state);
    send(socket, JSON.stringify({ type: 'system_state', state: pipeline.state, reset: false }));
    if (pipeline.latest) send(socket, pipeline.latest.json);
    socket.on('error', () => socket.terminate());
    socket.on('close', () => clients.delete(socket));
    socket.on('pong', () => { state.alive = true; });
    socket.on('message', (data, binary) => {
      // 外部 JSON 先进入 unknown，必须验证后才能使用；每连接最多 10 条控制/秒。
      if (Date.now() - state.lastCommand < 100) return;
      state.lastCommand = Date.now();
      if (binary) { send(socket, JSON.stringify({ type: 'error', error: 'Text JSON required' })); return; }
      try {
        const message: unknown = JSON.parse(data.toString());
        if (!selection(message)) { send(socket, JSON.stringify({ type: 'error', error: 'Expected select_target with targetId or null' })); return; }
        state.selected = message.targetId;
        send(socket, JSON.stringify({ type: 'selection', targetId: state.selected }));
      } catch { send(socket, JSON.stringify({ type: 'error', error: 'Invalid JSON' })); }
    });
  });
  const unsubscribe = pipeline.subscribe(message => {
    const status = JSON.stringify({ type: 'target_status', timestamp: message.frame.timestamp, targets: message.statuses });
    const contour = JSON.stringify({ type: 'risk_contours', timestamp: message.frame.timestamp, threshold: config.risk.threshold, segments: message.contours });
    for (const [socket, state] of clients) {
      // 有积压就丢当前帧，不追加队列；连续 30 次拥塞直接关闭。
      if (socket.bufferedAmount > 0) { if (++state.congested >= 30) socket.terminate(); continue; }
      state.congested = 0;
      send(socket, message.json); send(socket, status);
      if (message.contourDue) send(socket, contour);
      if (state.selected) {
        const target = message.frame.targets.find(t => t.id === state.selected);
        const prediction = target ? Array.from({ length: 11 }, (_, i) => {
          const seconds = i * 0.5, angle = target.fusion.heading * Math.PI / 180;
          return { seconds, x: target.fusion.x + target.fusion.speed * Math.sin(angle) * seconds, y: target.fusion.y + target.fusion.speed * Math.cos(angle) * seconds };
        }) : [];
        send(socket, JSON.stringify({ type: 'target_detail', timestamp: message.frame.timestamp, targetId: state.selected, target: target ?? null, status: message.statuses.find(t => t.id === state.selected) ?? null, model: 'constant_velocity', prediction }));
      }
    }
  });
  const unsubscribeState = pipeline.subscribeState((state, reset) => {
    for (const [socket, client] of clients) {
      if (reset) client.selected = null;
      send(socket, JSON.stringify({ type: 'system_state', state, reset }));
    }
  });
  const heartbeat = setInterval(() => {
    for (const [socket, state] of clients) {
      if (!state.alive || pipeline.state === 'failed') { socket.terminate(); continue; }
      state.alive = false; socket.ping();
    }
  }, 15000);
  heartbeat.unref();
  app.addHook('onClose', async () => {
    unsubscribe(); unsubscribeState(); clearInterval(heartbeat);
    for (const socket of clients.keys()) socket.terminate();
    await new Promise<void>(resolve => server.close(() => resolve()));
  });
}
