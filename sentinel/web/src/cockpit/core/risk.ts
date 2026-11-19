import type { Grid, RiskParams, Target } from '../types';
// TODO: 替换为用户公式。当前为演示用各向异性高斯场，不代表经过验证的安全风险模型。
export const riskParams: RiskParams = {
  sigma: 24,
  gain: 1,
  threshold: 0.75,
  predictionSeconds: 1.2,
};
export const riskGrid: Grid = {
  width: 128,
  height: 96,
  xMin: -200,
  xMax: 200,
  yMin: -200,
  yMax: 200,
};
export function targetContribution(
  target: Target,
  x: number,
  y: number,
  params: RiskParams,
): number {
  const f = target.fusion;
  if (!f || f.speed === null || f.vx === null || f.vy === null) return 0;
  const dx = x - f.x,
    dy = y - f.y;
  const speed = Math.max(f.speed, 0.01);
  const along = (dx * f.vx + dy * f.vy) / speed;
  const across = (dx * f.vy - dy * f.vx) / speed;
  const stretch = params.sigma + speed * params.predictionSeconds;
  return Math.min(
    0.99,
    (target.risk?.value ?? 0.2) *
      params.gain *
      Math.exp(
        -0.5 *
          ((along * along) / (stretch * stretch) +
            (across * across) / (params.sigma * params.sigma)),
      ),
  );
}
export function computeRiskField(targets: Target[], grid: Grid, params: RiskParams): Float32Array {
  const values = new Float32Array(grid.width * grid.height);
  for (let row = 0; row < grid.height; row++) {
    const y = grid.yMax - (row / (grid.height - 1)) * (grid.yMax - grid.yMin);
    for (let col = 0; col < grid.width; col++) {
      const x = grid.xMin + (col / (grid.width - 1)) * (grid.xMax - grid.xMin);
      let survival = 1;
      for (const target of targets) survival *= 1 - targetContribution(target, x, y, params);
      values[row * grid.width + col] = 1 - survival;
    }
  }
  return values;
}
/** 低风险蓝 → 青绿 → 黄 → 高风险红；仅核心区域出现红色。 */
export function riskColor(v: number): [number, number, number] {
  const stops = [
    [0, 7, 27, 49],
    [0.16, 13, 70, 118],
    [0.35, 12, 125, 121],
    [0.5, 57, 153, 100],
    [0.65, 166, 175, 65],
    [0.76, 222, 159, 58],
    [0.88, 215, 91, 61],
    [1, 213, 66, 56],
  ];
  for (let i = 1; i < stops.length; i++) {
    const a = stops[i - 1],
      b = stops[i];
    if (v <= b[0]) {
      const t = (v - a[0]) / (b[0] - a[0]);
      return [1, 2, 3].map((c) => Math.round(a[c] + (b[c] - a[c]) * t)) as [number, number, number];
    }
  }
  return [222, 76, 58];
}
