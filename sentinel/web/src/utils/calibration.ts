import type { CalibrationPoint } from '@/types';

export const DEFAULT_CALIBRATION_POINTS: CalibrationPoint[] = [
  { imageX: 0.22, imageY: 0.85, groundX: -8.5, groundY: 8.0 },
  { imageX: 0.86, imageY: 0.85, groundX: 9.5, groundY: 8.0 },
  { imageX: 0.72, imageY: 0.36, groundX: 11.0, groundY: 42.0 },
  { imageX: 0.28, imageY: 0.36, groundX: -10.0, groundY: 42.0 }
];

export function isPointInPolygon(
  x: number,
  y: number,
  poly: CalibrationPoint[] | null | undefined
): boolean {
  if (!poly || poly.length < 3) return false;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].groundX;
    const yi = poly[i].groundY;
    const xj = poly[j].groundX;
    const yj = poly[j].groundY;
    const intersect =
      yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-9) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}
