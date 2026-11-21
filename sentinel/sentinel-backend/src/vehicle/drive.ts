import { performance } from 'node:perf_hooks';
import type { FastifyInstance } from 'fastify';
import { WebSocket, WebSocketServer } from 'ws';
import type { CameraFrameStore } from '../live/camera.js';
import { makePedestrianFrame } from './demo.js';
import type { DriveDirection, DriveSnapshot } from './contracts.js';
import { evaluateVehicleRisk, vehicleLimits } from './risk.js';

export const driveTimeoutMs = 450;
const reverseLimitMps = 0.10;

// Each connection drives its own simulated chassis. Only this layer advances position.
export class SimulatedDrive {
  private travel = 0;
  private speed = 0;
  private direction: DriveDirection = 'stop';
  private deadline = 0;
  private expired = false;
  private lastTime: number;
  constructor(now: number) { this.lastTime = now; }

  private evaluate(now: number) {
    return evaluateVehicleRisk(makePedestrianFrame(this.travel, Math.max(0, this.speed), now), now);
  }
  private advance(now: number) {
    const end = Math.min(now, this.deadline);
    // A delayed timer cannot skip a risk check or integrate beyond the lease.
    while (this.direction !== 'stop' && this.lastTime < end) {
      const dt = Math.min(end - this.lastTime, 50);
      const risk = this.evaluate(this.lastTime);
      this.speed = this.direction === 'reverse' ? -reverseLimitMps : risk.motion.speedLimitMps;
      const delta = this.speed * dt / 1000;
      this.travel += delta > 0 && risk.closestForwardM !== null
        ? Math.min(delta, Math.max(0, risk.closestForwardM - vehicleLimits.stopDistanceM)) : delta;
      this.lastTime += dt;
    }
    this.lastTime = now;
    if (this.direction !== 'stop' && now >= this.deadline) {
      this.direction = 'stop';
      this.expired = true;
    }
    if (this.direction === 'stop') this.speed = 0;
  }
  command(action: DriveDirection | 'heartbeat' | 'reset', now: number) {
    this.advance(now);
    if (action === 'heartbeat') {
      if (this.direction !== 'stop') this.deadline = now + driveTimeoutMs;
      return;
    }
    if (action === 'reset') this.travel = 0;
    this.direction = action === 'reset' ? 'stop' : action;
    this.expired = false;
    this.deadline = now + driveTimeoutMs;
    this.speed = 0;
  }
  snapshot(now: number, wallTime: number): DriveSnapshot {
    this.advance(now);
    const frame = this.evaluate(wallTime);
    const reverse = this.direction === 'reverse';
    const limitMps = reverse ? reverseLimitMps : frame.motion.speedLimitMps;
    const requestedMps = reverse ? -reverseLimitMps : this.direction === 'forward' ? vehicleLimits.cruiseLimitMps : 0;
    this.speed = Math.sign(requestedMps) * Math.min(Math.abs(requestedMps), limitMps);
    return { frame, direction:this.direction, requestedMps, limitMps, speedMps:this.speed, travelM:this.travel, timedOut:this.expired };
  }
}

export function registerSimulatedDrive(app: FastifyInstance, origins: Set<string>, camera?: CameraFrameStore) {
  const server = new WebSocketServer({ noServer:true, maxPayload:128, perMessageDeflate:false });
  app.server.on('upgrade', (req, socket, head) => {
    if (req.url !== '/api/vehicle/drive') {
      if (app.server.listenerCount('upgrade') === 1) socket.destroy();
      return;
    }
    if (server.clients.size >= 16 || req.headers.origin && !origins.has(req.headers.origin)) { socket.destroy(); return; }
    server.handleUpgrade(req, socket, head, ws => server.emit('connection', ws));
  });
  server.on('connection', (ws: WebSocket) => {
    const drive = new SimulatedDrive(performance.now());
    function publish() {
      const now = Date.now();
      const state = drive.snapshot(performance.now(), now);
      if (ws.readyState === WebSocket.OPEN && ws.bufferedAmount < 128 * 1024)
        ws.send(JSON.stringify({ ...state, preview:camera?.snapshot(now) }));
    }
    const timer = setInterval(publish, 80);
    ws.on('message', (raw, binary) => {
      const action = raw.toString();
      if (binary || !['forward','reverse','stop','reset','heartbeat'].includes(action)) {
        drive.command('stop', performance.now()); ws.close(1008); return;
      }
      drive.command(action as Parameters<SimulatedDrive['command']>[0], performance.now());
      if (action !== 'heartbeat') publish();
    });
    ws.on('close', () => { clearInterval(timer); drive.command('stop', performance.now()); });
    ws.on('error', () => ws.terminate());
    publish();
  });
  app.addHook('onClose', async () => {
    for (const ws of server.clients) ws.terminate();
    await new Promise<void>(done => server.close(() => done()));
  });
}
