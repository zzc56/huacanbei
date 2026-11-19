import { config } from '../config.js';
import type { SensorBatch, SensorSource, CameraObservation } from '../contracts.js';

interface Vehicle { x: number; y: number; vx: number; vy: number; phase: number; kind: 'Car' | 'Truck' }
export class SensorSimulator implements SensorSource {
  private vehicles: Vehicle[] = [];
  private time = 0;
  private seed = 20261019;
  constructor() { this.reset(); }
  reset(): void {
    this.time = 0; this.seed = 20261019;
    this.vehicles = Array.from({ length: 8 }, (_, i) => ({ x: (i % 4 - 1.5) * 4, y: 18 + i * 9, vx: 0.3 * Math.sin(i * 0.7), vy: -2 - i * 0.3, phase: i * 0.7, kind: i % 3 === 0 ? 'Truck' : 'Car' }));
  }
  private noise(): number {
    // 可复现的均匀白噪声，返回单位方差值；不会修改物理轨迹。
    this.seed = (Math.imul(1664525, this.seed) + 1013904223) >>> 0;
    return (this.seed / 4294967296 - 0.5) * Math.sqrt(12);
  }
  sample(dt: number, timestamp: number): SensorBatch {
    if (!(dt > 0 && dt <= 0.2)) throw new RangeError('dt must be in (0, 0.2]');
    this.time += dt;
    const batch: SensorBatch = { timestamp, radar: [], camera: [] };
    for (const [i, v] of this.vehicles.entries()) {
      // 弹性巡航控制：接近边界前改变期望速度，|ay|≤1.5 m/s²，|ax|≤0.15。
      // 不做位置回绕或瞬移；半隐式 Euler 积分在固定 0.1 s 步长下稳定。
      const desired = v.y < 18 ? 3 : v.y > 85 ? -3 : Math.sign(v.vy || 1) * 3;
      const ay = Math.max(-1.5, Math.min(1.5, desired - v.vy));
      v.vy += ay * dt;
      v.vx = 0.3 * Math.sin(this.time * 0.5 + v.phase);
      v.x += v.vx * dt; v.y += v.vy * dt;
      const range = Math.hypot(v.x, v.y);
      // 两个模态独立丢检；输入无共享目标 ID，不能用真值偷做关联。
      if (range < config.radarMaxRange && (Math.floor(this.time) + i) % 13 !== 0) {
        batch.radar.push({ timestamp, range: range + 0.15 * this.noise(), azimuth: Math.atan2(v.x, v.y) * 180 / Math.PI + 0.12 * this.noise(), radialVelocity: (v.x * v.vx + v.y * v.vy) / range + 0.08 * this.noise(), covariance: { xx: 0.25, xy: 0, yy: 0.25 } });
      }
      const c = config.camera;
      const width = c.focal * (v.kind === 'Truck' ? 2.5 : 1.8) / v.y;
      const height = c.focal * (v.kind === 'Truck' ? 3 : 1.5) / v.y;
      const u = c.cx + c.focal * v.x / v.y + 0.4 * this.noise();
      const bottom = c.cy + c.focal * c.heightMeters / v.y + 0.4 * this.noise();
      if (u - width / 2 >= 0 && u + width / 2 < c.width && bottom < c.height && (Math.floor(this.time) + i) % 11 !== 0) {
        const observation: CameraObservation = { timestamp, bbox: [u - width / 2, bottom - height, width, height], class: v.kind, confidence: 0.92, covariance: { xx: 0.5, xy: 0, yy: Math.max(0.5, (v.y * v.y * 0.4 / (c.focal * c.heightMeters)) ** 2) } };
        batch.camera.push(observation);
      }
    }
    return batch;
  }
}
