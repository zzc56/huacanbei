import { config } from '../config.js';
import type { FrameData, Segment, Target } from '../contracts.js';

export interface RiskGrid { width: number; height: number; resolution: number; xMin: number; yMin: number }
export class RiskFieldEngine {
  private readonly grid: Float32Array;
  constructor(private readonly gridConfig: RiskGrid = config.grid, private readonly kernel: 'directional' | 'circular' = 'directional') {
    this.grid = new Float32Array(gridConfig.width * gridConfig.height);
  }
  compute(targets: Target[]): { field: NonNullable<FrameData['riskField']>; contours: Segment[]; values: Float32Array } {
    const g = this.gridConfig, p = config.risk;
    this.grid.fill(0);
    for (const target of targets) {
      const f = target.fusion;
      const distance = Math.hypot(f.x, f.y), closing = Math.max(0, -f.radialVelocity);
      // TTC=d/v_close（径向近似），远离或静止时为∞；不是碰撞轨迹的精确求交时间。
      const ttc = closing > 0.1 ? distance / closing : Infinity;
      // 可替换的研究模型：a=0.6e^(-d/D)+0.2(1-e^(-v/V))+0.8e^(-TTC/T)。
      // D[m]、V[m/s]、T[s] 控制距离、闭合速度与时间衰减，r=1-e^-a 限制到[0,1]。
      const amplitude = 0.6 * Math.exp(-distance / p.distanceScale) + 0.2 * (1 - Math.exp(-closing / p.speedScale)) + 0.8 * Math.exp(-ttc / p.ttcScale);
      const value = 1 - Math.exp(-amplitude);
      target.risk = { value, level: value > p.threshold ? 'high' : value >= 0.25 ? 'mid' : 'low' };
      const angle = f.heading * Math.PI / 180, sx = Math.sin(angle), sy = Math.cos(angle);
      const directionalSpread = p.sigma + f.speed * p.predictionSeconds;
      // 圆形核取原椭圆两轴的几何平均，保留各等值区域的面积及中心强度。
      // 速度仍影响扩散范围与强度；圆形核不表达运动方向。
      const circularSpread = Math.sqrt(directionalSpread * p.sigma);
      const longitudinal = this.kernel === 'circular' ? circularSpread : directionalSpread;
      const lateral = this.kernel === 'circular' ? circularSpread : p.sigma;
      // 两种影响核均在 3σ 之外截断。
      const radius = 3 * longitudinal;
      const x0 = Math.max(0, Math.floor((f.x - radius - g.xMin) / g.resolution));
      const x1 = Math.min(g.width - 1, Math.ceil((f.x + radius - g.xMin) / g.resolution));
      const y0 = Math.max(0, Math.floor((f.y - radius - g.yMin) / g.resolution));
      const y1 = Math.min(g.height - 1, Math.ceil((f.y + radius - g.yMin) / g.resolution));
      for (let row = y0; row <= y1; row++) for (let col = x0; col <= x1; col++) {
        const dx = g.xMin + (col + 0.5) * g.resolution - f.x, dy = g.yMin + (row + 0.5) * g.resolution - f.y;
        const along = dx * sx + dy * sy, across = dx * sy - dy * sx;
        const q = (along / longitudinal) ** 2 + (across / lateral) ** 2;
        if (q <= 9) this.grid[row * g.width + col]! += amplitude * Math.exp(-0.5 * q);
      }
    }
    // 多目标先叠加强度，再用 1-exp(-ΣaK) 饱和，避免线性相加超过 1。
    for (let i = 0; i < this.grid.length; i++) this.grid[i] = 1 - Math.exp(-this.grid[i]!);
    const field: NonNullable<FrameData['riskField']> = { gridWidth: g.width, gridHeight: g.height, resolution: g.resolution, highRiskZones: [] };
    const contours: Segment[] = [];
    const high = (row: number, col: number): boolean => row >= 0 && row < g.height && col >= 0 && col < g.width && this.grid[row * g.width + col]! > p.threshold;
    for (let row = 0; row < g.height; row++) {
      let col = 0;
      while (col < g.width) {
        if (!high(row, col)) { col++; continue; }
        const startColumn = col, values: number[] = [];
        while (col < g.width && high(row, col)) {
          // 两位小数量化，最大误差 0.005；阈值筛选使用未量化值。
          values.push(Math.round(this.grid[row * g.width + col]! * 100) / 100);
          const x = g.xMin + col * g.resolution, y = g.yMin + row * g.resolution, s = g.resolution;
          // 高风险栅格并集的精确边界；四邻域内边不发送，不冒充平滑等值线。
          if (!high(row - 1, col)) contours.push([x, y, x + s, y]);
          if (!high(row + 1, col)) contours.push([x, y + s, x + s, y + s]);
          if (!high(row, col - 1)) contours.push([x, y, x, y + s]);
          if (!high(row, col + 1)) contours.push([x + s, y, x + s, y + s]);
          col++;
        }
        field.highRiskZones.push({ row, startColumn, values });
      }
    }
    return { field, contours, values: this.grid.slice() };
  }
}
