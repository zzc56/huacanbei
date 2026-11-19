import type { RadarTarget } from '@/types';
import { formatTimeHmsMs } from '@/utils/format';

interface InternalAgent {
  id: number;
  cls: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  rcs: number;
  snr: number;
  energy: number;
  lastUpdatedMs: number;
}

export type RadarPreset = 'empty' | 'busy' | 'replay';

export class RadarSimulator {
  private agents: InternalAgent[] = [];
  private sequence = 0;
  private preset: RadarPreset = 'busy';
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(preset: RadarPreset = 'busy') {
    this.setPreset(preset);
  }

  setPreset(preset: RadarPreset): void {
    this.preset = preset;
    this.initAgents();
  }

  private initAgents(): void {
    this.agents = [];
    if (this.preset === 'empty') return;
    for (let i = 1; i <= 20; i++) {
      const laneX = ((i % 5) - 2) * 3.5 + (Math.random() - 0.5) * 0.8;
      const y = 6 + ((i * 4.7) % 88);
      const vy = i % 3 === 0 ? -(4 + (i % 8)) : 5 + (i % 10);
      const vx = (Math.random() - 0.5) * 0.6;
      const cls = i % 4 === 0 ? 1 : 0;
      this.agents.push({
        id: 100 + i,
        cls,
        x: Math.max(-19, Math.min(19, laneX)),
        y: Math.max(2, Math.min(96, y)),
        vx,
        vy,
        rcs: 8 + (i % 12) * 1.4,
        snr: 14 + (i % 9) * 1.8,
        energy: 62 + (i % 25),
        // 尚未产生回波的目标不能计入有效目标，也不能混用仿真时钟与墙上时钟。
        lastUpdatedMs: Number.NEGATIVE_INFINITY
      });
    }
  }

  stepBatch(nowMs = Date.now()): RadarTarget[] {
    if (this.preset === 'empty' || this.agents.length === 0) {
      return [];
    }
    const dt = 0.1;
    const batchSize = 2 + (this.sequence % 5); // 2 ~ 6 items per batch
    const batch: RadarTarget[] = [];

    for (let k = 0; k < batchSize; k++) {
      const idx = (this.sequence + k) % this.agents.length;
      const a = this.agents[idx];
      a.x += a.vx * dt + (Math.random() - 0.5) * 0.08;
      a.y += a.vy * dt * 2.2;

      if (a.x < -19.5) { a.x = -19.0; a.vx = Math.abs(a.vx); }
      if (a.x > 19.5) { a.x = 19.0; a.vx = -Math.abs(a.vx); }
      if (a.y > 98) { a.y = 4; }
      if (a.y < 2) { a.y = 95; }

      // Keep 1~2 targets occasionally dormant >2s to test expiration pruning
      if (idx === 19 && this.sequence % 40 < 25) {
        continue;
      }

      a.lastUpdatedMs = nowMs;
      this.sequence += 1;
      const range = Math.hypot(a.x, a.y);
      const angle = (Math.atan2(a.x, a.y) * 180) / Math.PI;
      const velocity = Math.hypot(a.vx, a.vy) * (a.vy >= 0 ? 1 : -1);
      const nowDate = new Date(nowMs);

      batch.push({
        id: a.id,
        cls: a.cls,
        x: Number(a.x.toFixed(2)),
        y: Number(a.y.toFixed(2)),
        vx: Number(a.vx.toFixed(2)),
        vy: Number(a.vy.toFixed(2)),
        range: Number(range.toFixed(2)),
        angle: Number(angle.toFixed(2)),
        velocity: Number(velocity.toFixed(2)),
        rcs: Number(a.rcs.toFixed(2)),
        snr: Number(a.snr.toFixed(2)),
        energy: Number(a.energy.toFixed(2)),
        vendorTime: formatTimeHmsMs(nowDate),
        sequence: this.sequence,
        receiveUtc: nowDate.toISOString()
      });
    }

    return batch;
  }

  getActiveTargets(nowMs = Date.now(), maxAgeMs = 2000): RadarTarget[] {
    return this.agents
      .filter((a) => nowMs >= a.lastUpdatedMs && nowMs - a.lastUpdatedMs <= maxAgeMs)
      .map((a) => {
        const range = Math.hypot(a.x, a.y);
        const angle = (Math.atan2(a.x, a.y) * 180) / Math.PI;
        const velocity = Math.hypot(a.vx, a.vy);
        const d = new Date(a.lastUpdatedMs);
        return {
          id: a.id,
          cls: a.cls,
          x: Number(a.x.toFixed(2)),
          y: Number(a.y.toFixed(2)),
          vx: Number(a.vx.toFixed(2)),
          vy: Number(a.vy.toFixed(2)),
          range: Number(range.toFixed(2)),
          angle: Number(angle.toFixed(2)),
          velocity: Number(velocity.toFixed(2)),
          rcs: Number(a.rcs.toFixed(2)),
          snr: Number(a.snr.toFixed(2)),
          energy: Number(a.energy.toFixed(2)),
          vendorTime: formatTimeHmsMs(d),
          sequence: this.sequence,
          receiveUtc: d.toISOString()
        };
      });
  }

  start(onBatch: (targets: RadarTarget[]) => void, intervalMs = 100): void {
    this.stop();
    this.timer = setInterval(() => {
      const batch = this.stepBatch(Date.now());
      if (batch.length > 0) {
        onBatch(batch);
      }
    }, intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
