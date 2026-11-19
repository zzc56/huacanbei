import type { Target } from '../types';
export const palette = {
  green: '#75e6b3',
  dim: '#54776d',
  amber: '#e8bf70',
  red: '#e58b73',
  cyan: '#76c6d2',
};
export function targetColor(t: Target, selected = false): string {
  return selected ? '#d1ffe9' : !t.radar ? palette.cyan : !t.camera ? palette.amber : palette.green;
}
export function line(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  color: string,
  width = 1,
) {
  ctx.beginPath();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}
export function label(
  ctx: CanvasRenderingContext2D,
  value: string,
  x: number,
  y: number,
  color = '#8bafa3',
  size = 12,
  align: CanvasTextAlign = 'left',
) {
  ctx.fillStyle = color;
  ctx.font = `${size}px "Consolas", "Microsoft YaHei", monospace`;
  ctx.textAlign = align;
  ctx.fillText(value, x, y);
}
export function diamond(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  color: string,
) {
  ctx.beginPath();
  ctx.moveTo(x, y - r);
  ctx.lineTo(x + r, y);
  ctx.lineTo(x, y + r);
  ctx.lineTo(x - r, y);
  ctx.closePath();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.4;
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.fillRect(x - 1.5, y - 1.5, 3, 3);
}
