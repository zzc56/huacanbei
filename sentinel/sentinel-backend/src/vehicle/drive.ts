import { performance } from 'node:perf_hooks';
import type { FastifyInstance } from 'fastify';
import { WebSocket, WebSocketServer } from 'ws';
import type { DriveSnapshot, StockLidarPreview, StockTelemetry, VehiclePose, VehicleResult } from './contracts.js';
import { StockTelemetryReader } from './stock-telemetry.js';
import { BenchDrive } from './bench-drive.js';
import { evaluateOnboardRadarRisk, vehicleLimits } from './risk.js';
import { StraightOdometry } from './straight-odometry.js';

export function registerVehicleDrive(app: FastifyInstance, origins: Set<string>, telemetryPort?: string,
                                     readFusionRisk?: (radar: StockLidarPreview, speedMps: number, pose?: VehiclePose) => VehicleResult | null) {
  const server = new WebSocketServer({ noServer: true, maxPayload: 256, perMessageDeflate: false });
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
    let odometry: StraightOdometry | null | undefined;
    function updateOdometry(now: number) {
      odometry?.update(telemetry?.wheelFeedbackForMotion(now) ?? null, bench?.isDrivingForward === true);
    }
    const fusionRisk = readFusionRisk && ((radar: StockLidarPreview, speedMps: number) => {
      if (odometry === undefined) return readFusionRisk(radar, speedMps);
      if (!odometry || !telemetry || radar.status !== 'online') return null;
      const now = Date.now();
      for (const scan of telemetry.radarHistory(performance.now())) {
        if (now - scan.receivedAtMs > vehicleLimits.maxAgeMs) break;
        const pose = odometry.poseAt(scan.receivedAtMs);
        if (!pose) continue;
        const result = readFusionRisk({ status:'online', sample:scan }, speedMps, pose);
        if (result) return result;
      }
      return null;
    });
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
      odometry = undefined;
    }
    function publish() {
      const now = performance.now();
      const state: DriveSnapshot = {};
      updateOdometry(now);
      if (bench) state.bench = bench.snapshot(now);
      const feedback = telemetrySnapshot();
      if (feedback) state.telemetry = feedback;
      if (odometry !== undefined) {
        const pose = odometry?.poseAt(Date.now());
        state.odometry = pose ? { status:'tracking', pose } : { status:'reset_required' };
      }
      if (ws.readyState !== WebSocket.OPEN || ws.bufferedAmount >= 128 * 1024) return;
      if (feedback?.lidar && telemetry) {
        const radar = telemetry.radarForMotion(now);
        const wheels = telemetry?.wheelFeedbackForMotion(now);
        const speedMps = wheels ? (wheels.wheelAMps + wheels.wheelBMps) / 2 : 0;
        const radarRisk = evaluateOnboardRadarRisk(radar, speedMps, true);
        if (radarRisk) state.radarRisk = radarRisk;
        const fused = wheels && fusionRisk?.(radar, speedMps);
        if (fused) state.fusionRisk = fused;
      }
      ws.send(JSON.stringify(state));
    }
    const timer = setInterval(publish, 80);
    ws.on('message', (raw, binary) => {
      const action = raw.toString();
      const now = performance.now();
      updateOdometry(now);
      if (!binary && (action === 'bench:radar' || action === 'bench:fusion' || action === 'bench:end')) {
        if (localBrowser && telemetry && telemetryOwner === ws) {
          const sample = telemetry.snapshot().sample;
          if (!bench && (action === 'bench:radar' || action === 'bench:fusion' && fusionRisk)) {
            bench = new BenchDrive(telemetry, now, sample, action === 'bench:fusion' ? fusionRisk : undefined);
          } else if (action === 'bench:end' && bench) {
            bench.end(now, sample);
            bench = undefined;
          }
        }
      } else if (!binary && (action.startsWith('pose:') || action === 'clear-pose')) {
        if (localBrowser && telemetry && telemetryOwner === ws && !bench) {
          if (action === 'clear-pose') odometry = undefined;
          else {
            const [stationaryId, x, y, heading, extra] = action.slice(5).split(':');
            const xM = Number(x), yM = Number(y), headingDeg = Number(heading);
            const stationary = telemetry.stationaryForMotion(now), wheels = telemetry.wheelFeedbackForMotion(now);
            const valid = extra === undefined && !!x && !!y && !!heading && Number.isFinite(xM) && Math.abs(xM) <= 1000 &&
              Number.isFinite(yM) && Math.abs(yM) <= 1000 && Number.isFinite(headingDeg) && Math.abs(headingDeg) <= 360;
            odometry = valid && stationary && stationary.id === stationaryId && wheels?.wheelAMps === 0 && wheels.wheelBMps === 0
              ? new StraightOdometry({xM, yM, headingDeg}, wheels) : null;
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
