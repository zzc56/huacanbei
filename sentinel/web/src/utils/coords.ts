export interface ViewportTransform {
  scale: number;   // 0.5 ~ 6.0
  offsetX: number; // px
  offsetY: number; // px
}

export interface PlotBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export interface WorldRange {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}

export function createDefaultTransform(): ViewportTransform {
  return { scale: 1, offsetX: 0, offsetY: 0 };
}

export function clampScale(scale: number, min = 0.5, max = 6.0): number {
  return Math.max(min, Math.min(max, scale));
}

export function zoomAtPoint(
  transform: ViewportTransform,
  factor: number,
  cursorX: number,
  cursorY: number,
  centerX: number,
  centerY: number
): ViewportTransform {
  const nextScale = clampScale(transform.scale * factor);
  const ratio = nextScale / transform.scale;
  const dx = cursorX - centerX - transform.offsetX;
  const dy = cursorY - centerY - transform.offsetY;
  return {
    scale: nextScale,
    offsetX: transform.offsetX - dx * (ratio - 1),
    offsetY: transform.offsetY - dy * (ratio - 1)
  };
}

export function worldToScreen(
  wx: number,
  wy: number,
  range: WorldRange,
  bounds: PlotBounds,
  transform: ViewportTransform = { scale: 1, offsetX: 0, offsetY: 0 }
): { sx: number; sy: number } {
  const nx = (wx - range.xMin) / Math.max(1e-6, range.xMax - range.xMin);
  const ny = (wy - range.yMin) / Math.max(1e-6, range.yMax - range.yMin);
  const baseX = bounds.left + nx * bounds.width;
  const baseY = bounds.bottom - ny * bounds.height;
  const cx = bounds.left + bounds.width * 0.5;
  const cy = bounds.top + bounds.height * 0.5;
  return {
    sx: cx + (baseX - cx) * transform.scale + transform.offsetX,
    sy: cy + (baseY - cy) * transform.scale + transform.offsetY
  };
}

export function screenToWorld(
  sx: number,
  sy: number,
  range: WorldRange,
  bounds: PlotBounds,
  transform: ViewportTransform = { scale: 1, offsetX: 0, offsetY: 0 }
): { wx: number; wy: number } {
  const cx = bounds.left + bounds.width * 0.5;
  const cy = bounds.top + bounds.height * 0.5;
  const baseX = cx + (sx - cx - transform.offsetX) / transform.scale;
  const baseY = cy + (sy - cy - transform.offsetY) / transform.scale;
  const nx = (baseX - bounds.left) / Math.max(1e-6, bounds.width);
  const ny = (bounds.bottom - baseY) / Math.max(1e-6, bounds.height);
  return {
    wx: range.xMin + nx * (range.xMax - range.xMin),
    wy: range.yMin + ny * (range.yMax - range.yMin)
  };
}
