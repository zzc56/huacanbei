import { expect, it } from 'vitest';
import { groundMap } from '../renderers/lightScene';

it('fills a wide field plot with expanded horizontal bounds and equal metre scales', () => {
  const bounds = { xMin: -150, xMax: 150, yMin: -20, yMax: 202 };
  const plot = groundMap(900, 700, bounds), origin = plot.map(0, 0);
  const left = plot.map(bounds.xMin, bounds.yMin), right = plot.map(bounds.xMax, bounds.yMax);
  expect(right[0] - left[0]).toBeGreaterThan(900 * .85);
  expect(left[1] - right[1]).toBeGreaterThan(700 * .8);
  expect(plot.scaleX).toBe(plot.scaleY);
  for (const [x, y] of [[-40, 10], [20, 150], [0, 0]]) {
    const pixel = plot.map(x, y);
    expect((pixel[0] - origin[0]) / plot.scaleX).toBeCloseTo(x);
    expect((origin[1] - pixel[1]) / plot.scaleY).toBeCloseTo(y);
  }
});
it.each([[900, 700], [640, 480], [1400, 700]])('keeps risk circles circular at %i × %i', (width, height) => {
  const plot = groundMap(width, height, { xMin: -150, xMax: 150, yMin: -20, yMax: 202 });
  const center = plot.map(20, 80);
  const radius = 12 * plot.scale;
  for (let angle = 0; angle < 2 * Math.PI; angle += Math.PI / 8) {
    const point = plot.map(20 + 12 * Math.cos(angle), 80 + 12 * Math.sin(angle));
    expect(Math.hypot(point[0] - center[0], point[1] - center[1])).toBeCloseTo(radius);
  }
});
it('enlarges the forward radar view with equal metre scales and an undistorted range ring', () => {
  const full = groundMap(900, 320, { xMin: -200, xMax: 200, yMin: -200, yMax: 200 });
  const forward = groundMap(900, 320, { xMin: -200, xMax: 200, yMin: -10, yMax: 200 });
  expect(forward.scale).toBeGreaterThan(full.scale * 1.8);
  expect(forward.scaleX).toBe(forward.scaleY);
  const origin = forward.map(0, 0), east = forward.map(100, 0), front = forward.map(0, 100);
  expect(east[0] - origin[0]).toBeCloseTo(origin[1] - front[1]);
  expect(forward.map(0, 200)[1]).toBeGreaterThan(0);
});
