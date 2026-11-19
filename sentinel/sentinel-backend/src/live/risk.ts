import type { Target } from '../contracts.js';
import { RiskFieldEngine } from '../engines/risk-field.engine.js';
import type { RadarObservation } from './tcr300.js';

/** Sensor-local relative index. Camera pixels are excluded until joint calibration exists. */
export class LiveRiskField {
  readonly bounds = { xMin: -150, xMax: 150, yMin: -20, yMax: 200 };
  private cached: ReturnType<LiveRiskField['compute']> | null = null;
  private key = '';

  snapshot(observations: RadarObservation[], cycleAt: number | null, now: number) {
    if (cycleAt === null || !Number.isFinite(cycleAt) || cycleAt > now || now - cycleAt > 1500 ||
        observations.some(r => ![r.range, r.angle, r.vx_lateral, r.vy_longitudinal].every(Number.isFinite) ||
          r.range < 0 || r.range > 2000 || !Number.isFinite(Date.parse(r.host_received_utc)) ||
          Date.parse(r.host_received_utc) > now || now - Date.parse(r.host_received_utc) > 1500)) {
      this.key = ''; this.cached = null;
      return null;
    }
    const key = `${cycleAt}:${observations.map(r => r.target_seq).join(',')}`;
    if (key !== this.key) {
      this.cached = this.compute(observations, cycleAt);
      this.key = key;
    }
    return this.cached;
  }

  private compute(observations: RadarObservation[], cycleAt: number) {
    const targets: Target[] = observations.map(r => {
      // Use the same measured range/azimuth convention as the frontend.
      const angle = r.angle * Math.PI / 180;
      const x = r.range * Math.sin(angle), y = r.range * Math.cos(angle);
      const vx = r.vx_lateral, vy = r.vy_longitudinal;
      return {
        id: `radar:${r.track_id}`,
        fusion: { x, y, speed: Math.hypot(vx, vy), heading: Math.atan2(vx, vy) * 180 / Math.PI,
          azimuth: r.angle, radialVelocity: r.range > 1e-6 ? (x * vx + y * vy) / r.range : 0,
          tangentialVelocity: r.range > 1e-6 ? (y * vx - x * vy) / r.range : 0 },
        risk: { value: 0, level: 'low' },
      };
    });
    // Expand to include measured targets, but do not zoom in/out every empty cycle.
    for (const { fusion: f } of targets) {
      this.bounds.xMin = Math.min(this.bounds.xMin, Math.floor((f.x - 10) / 20) * 20);
      this.bounds.xMax = Math.max(this.bounds.xMax, Math.ceil((f.x + 10) / 20) * 20);
      this.bounds.yMin = Math.min(this.bounds.yMin, Math.floor((f.y - 10) / 20) * 20);
      this.bounds.yMax = Math.max(this.bounds.yMax, Math.ceil((f.y + 10) / 20) * 20);
    }
    const b = this.bounds, resolution = Math.max(1, Math.ceil(Math.max(b.xMax - b.xMin, b.yMax - b.yMin) / 120));
    const width = Math.ceil((b.xMax - b.xMin) / resolution) + 1, height = Math.ceil((b.yMax - b.yMin) / resolution) + 1;
    b.xMax = b.xMin + (width - 1) * resolution;
    b.yMax = b.yMin + (height - 1) * resolution;
    const engine = new RiskFieldEngine({ width, height, resolution, xMin: b.xMin - resolution / 2, yMin: b.yMin - resolution / 2 }, 'circular');
    const { values } = engine.compute(targets);
    const observedAt = Math.max(cycleAt, ...observations.map(r => Date.parse(r.host_received_utc)));
    return {
      host_utc: new Date(observedAt).toISOString(),
      observation_utc: new Date(observedAt).toISOString(),
      valid_until_utc: new Date(cycleAt + 1500).toISOString(),
      status: 'radar_only', field_available: true, field_scope: 'radar_only',
      calibration_valid: false, calibration: null, vision_sequence: null,
      model_version: 'live-radar-circular-distance-ttc-v2',
      message: targets.length
        ? '实时雷达相对风险估计 · 圆形影响范围 · 基于距离与运动量 · 尚未联合标定'
        : '雷达在线，当前无目标 · 场值为零表示无目标贡献，非安全保证',
      grid_width: width, grid_height: height,
      x_axis: Array.from({ length: width }, (_, i) => b.xMin + i * resolution),
      y_axis: Array.from({ length: height }, (_, i) => b.yMin + i * resolution),
      // Send all evaluated cells, including low values. A high-only sparse field
      // looks blank in ordinary scenes and cannot describe the full heatmap.
      display_field: Array.from(values, value => Math.round(value * 10000) / 10000),
      valid_field_mask: Array<boolean>(width * height).fill(true),
    };
  }
}
