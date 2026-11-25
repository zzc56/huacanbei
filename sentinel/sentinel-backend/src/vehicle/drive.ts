import { performance } from 'node:perf_hooks';
import type { FastifyInstance } from 'fastify';
import { WebSocket, WebSocketServer } from 'ws';
import type { DriveSnapshot, StockLidarPreview, StockTelemetry, VehicleResult } from './contracts.js';
import { StockTelemetryReader } from './stock-telemetry.js';
import { BenchDrive } from './bench-drive.js';
import { evaluateOnboardRadarRisk } from './risk.js';

export function registerVehicleDrive(app: FastifyInstance, origins: Set<string>, telemetryPort?: string,
                                     readFusionRisk?: (radar: StockLidarPreview, speedMps: number) => VehicleResult | null) {
  const server = new WebSocketServer({ noServer: true, maxPayload: 128, perMessageDeflate: false });
  const telemetry = telemetryPort ? new StockTelemetryReader(telemetryPort) : undefined;
  let telemetryOwner: WebSocket | undefined;
  app.server.on('upgrade', (req, socket, head) => {
    if (req.url !== '/api/vehicle/drive') {
      if (app.server.listenerCount('upgrade') === 1) socket.destroy();
      return;
    }
    if (server.clients.size >= 16 || req.headers.origin && !origins.has(req.headers.origin)) { socket.destroy(); return; }
    const local = ['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress ?? '');
    const localBrowser = local && req.headers.origin !== undefined && origins.has(req.headers.origin);
    server.handleUpgrade(req, socket, head, ws => server.emit('connection', ws, localBrowser));
  });

  server.on('connection', (ws: WebSocket, localBrowser: boolean) => {
    let telemetryBusy = false;
    let bench: BenchDrive | undefined;
    function telemetrySnapshot(): StockTelemetry | undefined {
      if (!telemetry) return undefined;
      if (telemetryOwner === ws) return telemetry.snapshot();
      return { port: telemetry.port, sample: null, status: telemetryBusy && telemetryOwner ? 'busy' : 'idle' };
    }
    function releaseTelemetry() {
      if (telemetryOwner !== ws) return;
      telemetryOwner = undefined;
      telemetry?.close(bench !== undefined);
      bench = undefined;
    }
    function publish() {
      const now = performance.now();
      const state: DriveSnapshot = {};
      if (bench) state.bench = bench.snapshot(now);
      const feedback = telemetrySnapshot();
      if (feedback) state.telemetry = feedback;
      if (ws.readyState !== WebSocket.OPEN || ws.bufferedAmount >= 128 * 1024) return;
      if (feedback?.lidar && telemetry) {
        const radar = telemetry.radarForMotion(now);
        const wheels = telemetry?.wheelFeedbackForMotion(now);
        const speedMps = wheels ? (wheels.wheelAMps + wheels.wheelBMps) / 2 : 0;
        const radarRisk = evaluateOnboardRadarRisk(radar, speedMps);
        if (radarRisk) state.radarRisk = radarRisk;
        const fusionRisk = wheels && readFusionRisk?.(radar, speedMps);
        if (fusionRisk) state.fusionRisk = fusionRisk;
      }
      ws.send(JSON.stringify(state));
    }
    const timer = setInterval(publish, 80);
    ws.on('message', (raw, binary) => {
      const action = raw.toString();
      const now = performance.now();
      if (!binary && (action === 'bench:radar' || action === 'bench:fusion' || action === 'bench:end')) {
        if (localBrowser && telemetry && telemetryOwner === ws) {
          const sample = telemetry.snapshot().sample;
          if (!bench && (action === 'bench:radar' || action === 'bench:fusion' && readFusionRisk)) {
            bench = new BenchDrive(telemetry, now, sample, action === 'bench:fusion' ? readFusionRisk : undefined);
          } else if (action === 'bench:end' && bench) {
            bench.end(now, sample);
            bench = undefined;
          }
        }
      } else if (!binary && telemetry && (action === 'telemetry:open' || action === 'telemetry:close')) {
        telemetryBusy = false;
        if (action === 'telemetry:close') releaseTelemetry();
        else if (!telemetryOwner || telemetryOwner === ws) {
          telemetryOwner = ws;
          telemetry.start();
        } else telemetryBusy = true;
      } else if (!binary && (action === 'forward' || action === 'stop' || action === 'heartbeat')) {
        bench?.command(action, now);
      } else {
        bench?.command('stop', now);
        ws.close(1008);
        return;
      }
      if (action !== 'heartbeat') publish();
    });
    ws.on('close', () => { clearInterval(timer); releaseTelemetry(); });
    ws.on('error', () => ws.terminate());
    publish();
  });

  app.addHook('onClose', async () => {
    for (const ws of server.clients) ws.terminate();
    await new Promise<void>(done => server.close(() => done()));
    telemetry?.close();
  });
  return (stationaryId: string) => {
    if (!telemetryOwner || !telemetry) return null;
    const now = performance.now();
    const stationary = telemetry.stationaryForMotion(now);
    if (!stationary || stationary.id !== stationaryId) return null;
    return {sinceMs:stationary.sinceMs, scans:telemetry.radarHistory(now)};
  };
}
