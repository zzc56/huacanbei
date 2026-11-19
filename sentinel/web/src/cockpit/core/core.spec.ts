import { describe, expect, it } from 'vitest';
import { interpolateTargets, solveFusion } from './fusion';
import { computeRiskField, riskParams } from './risk';
import { mockFrame } from '../services/stream';
describe('驾驶舱坐标、融合及风险模型', () => {
  it('采用正北顺时针方位角，分速度可重建运动速度', () => {
    expect(solveFusion(0, 100, 0, -10).azimuth).toBe(0);
    expect(solveFusion(100, 0, 0, -10).azimuth).toBe(90);
    const f = solveFusion(30, -40, 6, -8);
    expect(f.radialVelocity).toBeCloseTo(10);
    expect(f.tangentialVelocity).toBeCloseTo(0);
    expect(f.radialVelocity ** 2 + f.tangentialVelocity ** 2).toBeCloseTo(f.speed ** 2);
  });
  it('Mock 位置的一阶导数与输出速度一致', () => {
    const a = mockFrame(10),
      b = mockFrame(10.0001);
    a.targets.forEach((target, i) => {
      expect((b.targets[i].fusion!.x - target.fusion!.x) / 0.0001).toBeCloseTo(
        target.fusion!.vx!,
        3,
      );
      expect((b.targets[i].fusion!.y - target.fusion!.y) / 0.0001).toBeCloseTo(
        target.fusion!.vy!,
        3,
      );
    });
  });
  it('风险场保持有限归一化、空场为零、目标核心高于远处', () => {
    const targets = mockFrame(0).targets;
    const grid = { width: 31, height: 31, xMin: -200, xMax: 200, yMin: -200, yMax: 200 };
    const field = computeRiskField(targets, grid, riskParams);
    expect(field.every((v) => Number.isFinite(v) && v >= 0 && v <= 1)).toBe(true);
    expect(Math.max(...field)).toBeGreaterThan(0.75);
    expect(computeRiskField([], grid, riskParams).every((v) => v === 0)).toBe(true);
    expect(field[0]).toBeLessThan(0.05);
  });
  it('真实图像框保持接口坐标，不会被 Mock 投影覆盖', () => {
    const a = mockFrame(0).targets,
      b = mockFrame(1).targets;
    a[0].camera!.bbox = [0.1, 0.2, 0.3, 0.4];
    b[0].camera!.bbox = [0.3, 0.4, 0.5, 0.6];
    const output = interpolateTargets(a, b, 0.5)[0].camera!.bbox;
    output.forEach((v, i) => expect(v).toBeCloseTo([0.2, 0.3, 0.4, 0.5][i]));
  });
});
