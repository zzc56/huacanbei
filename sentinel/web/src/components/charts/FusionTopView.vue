<template>
  <div
    ref="wrapRef"
    class="fusion-topview-wrap"
    :title="COPY.TOOLTIP_RESET_VIEW"
  >
    <canvas
      ref="canvasRef"
      class="fusion-canvas"
      @wheel.prevent="onWheel"
      @mousedown="onMouseDown"
      @mousemove="onMouseMove"
      @mouseup="onMouseUp"
      @mouseleave="onMouseUp"
      @dblclick="resetView"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount } from 'vue';
import type { FusionSnapshot } from '@/types';
import { COPY } from '@/types';
import {
  createDefaultTransform,
  zoomAtPoint,
  worldToScreen,
  type ViewportTransform
} from '@/utils/coords';
import { RafScheduler } from '@/utils/raf';

const props = defineProps<{
  snapshot: FusionSnapshot | null;
  showCalibrationBoundary: boolean;
}>();

const wrapRef = ref<HTMLDivElement | null>(null);
const canvasRef = ref<HTMLCanvasElement | null>(null);
const transform = ref<ViewportTransform>(createDefaultTransform());
const dragging = ref(false);
const dragStart = ref({ x: 0, y: 0, ox: 0, oy: 0 });
let resizeObs: ResizeObserver | null = null;

function parseCssColorToRgb(cssVarVal: string): [number, number, number] {
  const probe = document.createElement('div');
  probe.style.color = cssVarVal;
  document.body.appendChild(probe);
  const computed = getComputedStyle(probe).color;
  document.body.removeChild(probe);
  const m = computed.match(/(\d+),\s*(\d+),\s*(\d+)/);
  if (!m) return [27, 43, 68];
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function interpolateHeatColor(
  val: number,
  stops: [number, number, number][]
): string {
  const clamped = Math.max(0, Math.min(1, val));
  const scaled = clamped * (stops.length - 1);
  const idx = Math.min(stops.length - 2, Math.floor(scaled));
  const frac = scaled - idx;
  const c0 = stops[idx];
  const c1 = stops[idx + 1];
  const r = Math.round(c0[0] + (c1[0] - c0[0]) * frac);
  const g = Math.round(c0[1] + (c1[1] - c0[1]) * frac);
  const b = Math.round(c0[2] + (c1[2] - c0[2]) * frac);
  return `rgba(${r}, ${g}, ${b}, ${0.28 + clamped * 0.62})`;
}

function draw(): void {
  const canvas = canvasRef.value;
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const dpr = window.devicePixelRatio || 1;
  const width = canvas.clientWidth || 560;
  const height = canvas.clientHeight || 420;
  if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
  }

  ctx.save();
  ctx.scale(dpr, dpr);

  const rootStyle = getComputedStyle(document.documentElement);
  const cCanvas = rootStyle.getPropertyValue('--c-canvas').trim();
  const cGrid = rootStyle.getPropertyValue('--c-grid').trim();
  const cAxis = rootStyle.getPropertyValue('--c-axis').trim();
  const cInk3 = rootStyle.getPropertyValue('--c-ink-3').trim();
  const cTeal = rootStyle.getPropertyValue('--c-teal').trim();
  const cAmber = rootStyle.getPropertyValue('--c-amber').trim();

  const heatStops: [number, number, number][] = [
    parseCssColorToRgb(rootStyle.getPropertyValue('--heat-0').trim()),
    parseCssColorToRgb(rootStyle.getPropertyValue('--heat-1').trim()),
    parseCssColorToRgb(rootStyle.getPropertyValue('--heat-2').trim()),
    parseCssColorToRgb(rootStyle.getPropertyValue('--heat-3').trim()),
    parseCssColorToRgb(rootStyle.getPropertyValue('--heat-4').trim())
  ];

  ctx.fillStyle = cCanvas;
  ctx.fillRect(0, 0, width, height);

  const snap = props.snapshot;
  const xMin = snap?.config.xMin ?? -20;
  const xMax = snap?.config.xMax ?? 20;
  const yMin = snap?.config.yMin ?? 0;
  const yMax = snap?.config.yMax ?? 60;
  const worldW = Math.max(10, xMax - xMin);
  const worldH = Math.max(10, yMax - yMin);

  // Isotropic X/Y meter scale calculation
  const padL = 48;
  const padR = 20;
  const padT = 22;
  const padB = 42;
  const availW = Math.max(80, width - padL - padR);
  const availH = Math.max(80, height - padT - padB);
  const pxPerMeter = Math.min(availW / worldW, availH / worldH);
  const plotW = worldW * pxPerMeter;
  const plotH = worldH * pxPerMeter;
  const left = padL + (availW - plotW) * 0.5;
  const top = padT + (availH - plotH) * 0.5;

  const bounds = {
    left,
    top,
    right: left + plotW,
    bottom: top + plotH,
    width: plotW,
    height: plotH
  };
  const range = { xMin, xMax, yMin, yMax };

  const cx = bounds.left + bounds.width * 0.5;
  const cy = bounds.top + bounds.height * 0.5;
  ctx.save();
  ctx.translate(cx + transform.value.offsetX, cy + transform.value.offsetY);
  ctx.scale(transform.value.scale, transform.value.scale);
  ctx.translate(-cx, -cy);

  // 1. Draw Heatmap ONLY when displayField !== null
  if (snap && snap.displayField !== null && snap.fieldAvailable) {
    const gw = snap.gridWidth;
    const gh = snap.gridHeight;
    const cellW = bounds.width / gw;
    const cellH = bounds.height / gh;

    for (let j = 0; j < gh; j++) {
      for (let i = 0; i < gw; i++) {
        const idx = j * gw + i;
        if (snap.validFieldMask && !snap.validFieldMask[idx]) continue;
        const val = snap.displayField[idx] ?? 0;
        if (val <= 0.015) continue;
        const cellX = bounds.left + i * cellW;
        const cellY = bounds.bottom - (j + 1) * cellH;
        ctx.fillStyle = interpolateHeatColor(val, heatStops);
        ctx.fillRect(cellX, cellY, cellW + 0.6, cellH + 0.6);
      }
    }
  }

  // 2. Grid lines & axes
  for (let i = 0; i <= 8; i++) {
    const ratio = i / 8;
    const gx = bounds.left + ratio * bounds.width;
    ctx.beginPath();
    ctx.strokeStyle = i === 4 ? cAxis : cGrid;
    ctx.lineWidth = i === 4 ? 1.3 : 0.8;
    ctx.moveTo(gx, bounds.top);
    ctx.lineTo(gx, bounds.bottom);
    ctx.stroke();

    const xVal = xMin + ratio * worldW;
    ctx.fillStyle = cInk3;
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(xVal.toFixed(0), gx, bounds.bottom + 14);
  }

  for (let j = 0; j <= 6; j++) {
    const ratio = j / 6;
    const gy = bounds.bottom - ratio * bounds.height;
    ctx.beginPath();
    ctx.strokeStyle = cGrid;
    ctx.lineWidth = 0.8;
    ctx.moveTo(bounds.left, gy);
    ctx.lineTo(bounds.right, gy);
    ctx.stroke();

    const yVal = yMin + ratio * worldH;
    ctx.fillStyle = cInk3;
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(yVal.toFixed(0), bounds.left - 6, gy + 3);
  }

  // 3. Calibration Polygon (1.5px yellow stroke, toggleable without clearing data)
  if (props.showCalibrationBoundary && snap?.calibration && snap.calibration.length >= 3) {
    ctx.save();
    ctx.strokeStyle = cAmber;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 3]);
    ctx.beginPath();
    snap.calibration.forEach((pt, idx) => {
      const { sx, sy } = worldToScreen(pt.groundX, pt.groundY, range, bounds);
      if (idx === 0) ctx.moveTo(sx, sy);
      else ctx.lineTo(sx, sy);
    });
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
  }

  // 4. Highest relativeRisk interaction pair dashed connection
  if (snap && snap.interactions.length > 0) {
    const topPair = snap.interactions[0];
    const rObj = snap.radarObjects.find((o) => o.id === topPair.radarId);
    const pObj = snap.pedestrians.find((o) => o.id === topPair.pedestrianId);
    if (rObj && pObj) {
      const p1 = worldToScreen(rObj.x, rObj.y, range, bounds);
      const p2 = worldToScreen(pObj.x, pObj.y, range, bounds);
      ctx.save();
      ctx.strokeStyle = cAmber;
      ctx.lineWidth = 1.6;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(p1.sx, p1.sy);
      ctx.lineTo(p2.sx, p2.sy);
      ctx.stroke();
      ctx.setLineDash([]);
      const mx = (p1.sx + p2.sx) * 0.5;
      const my = (p1.sy + p2.sy) * 0.5;
      ctx.fillStyle = cAmber;
      ctx.font = '600 10px sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(
        `TTC ${topPair.timeToClosestSeconds.toFixed(1)}s / ${topPair.closestDistanceMeters.toFixed(1)}m`,
        mx + 6,
        my - 4
      );
      ctx.restore();
    }
  }

  // 5. Radar Objects (4.5x1.8m prior footprint + center point + velocity arrow + ID)
  if (snap) {
    const footW = Math.max(6, 1.8 * pxPerMeter);
    const footH = Math.max(12, 4.5 * pxPerMeter);
    for (const r of snap.radarObjects) {
      const { sx, sy } = worldToScreen(r.x, r.y, range, bounds);
      ctx.save();
      ctx.strokeStyle = cAmber;
      ctx.fillStyle = 'rgba(250, 191, 92, 0.20)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.roundRect(sx - footW * 0.5, sy - footH * 0.5, footW, footH, 3);
      ctx.fill();
      ctx.stroke();

      // Center point
      ctx.fillStyle = cAmber;
      ctx.beginPath();
      ctx.arc(sx, sy, 3.5, 0, Math.PI * 2);
      ctx.fill();

      // Velocity arrow
      if (r.velocityKnown) {
        const speed = Math.hypot(r.vx, r.vy);
        if (speed > 0.2) {
          const normLen = Math.min(28, speed * 2.2);
          const ax = sx + (r.vx / speed) * normLen;
          const ay = sy - (r.vy / speed) * normLen;
          ctx.beginPath();
          ctx.moveTo(sx, sy);
          ctx.lineTo(ax, ay);
          ctx.stroke();
        }
      }

      ctx.fillStyle = cInk3;
      ctx.font = '10px sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(r.id.replace('R-', 'ID '), sx + footW * 0.5 + 4, sy + 3);
      ctx.restore();
    }

    // 6. Pedestrians (0.6x0.6m circle + --c-teal + P n label)
    for (const p of snap.pedestrians) {
      const { sx, sy } = worldToScreen(p.x, p.y, range, bounds);
      const pr = Math.max(4.5, 0.6 * pxPerMeter);
      ctx.save();
      ctx.fillStyle = cTeal;
      ctx.beginPath();
      ctx.arc(sx, sy, pr, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = cInk3;
      ctx.font = '600 10px sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(p.id.replace('-', ' '), sx + pr + 4, sy + 3);
      ctx.restore();
    }
  }

  ctx.restore();

  // Status overlay banner if expired or uncalibrated
  if (snap && snap.status !== 'ok') {
    ctx.fillStyle = 'rgba(17, 28, 44, 0.82)';
    ctx.fillRect(bounds.left + 8, bounds.top + 8, bounds.width - 16, 28);
    ctx.fillStyle = cAmber;
    ctx.font = '600 11px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(snap.message, bounds.left + 16, bounds.top + 26);
  }

  ctx.restore();
}

const scheduler = new RafScheduler(draw);

function onWheel(ev: WheelEvent): void {
  if (!canvasRef.value) return;
  const rect = canvasRef.value.getBoundingClientRect();
  const factor = ev.deltaY < 0 ? 1.15 : 1 / 1.15;
  transform.value = zoomAtPoint(
    transform.value,
    factor,
    ev.clientX - rect.left,
    ev.clientY - rect.top,
    rect.width * 0.5,
    rect.height * 0.5
  );
  scheduler.schedule();
}

function onMouseDown(ev: MouseEvent): void {
  if (ev.button !== 0) return;
  dragging.value = true;
  dragStart.value = {
    x: ev.clientX,
    y: ev.clientY,
    ox: transform.value.offsetX,
    oy: transform.value.offsetY
  };
}

function onMouseMove(ev: MouseEvent): void {
  if (!dragging.value) return;
  transform.value = {
    ...transform.value,
    offsetX: dragStart.value.ox + (ev.clientX - dragStart.value.x),
    offsetY: dragStart.value.oy + (ev.clientY - dragStart.value.y)
  };
  scheduler.schedule();
}

function onMouseUp(): void {
  dragging.value = false;
}

function resetView(): void {
  transform.value = createDefaultTransform();
  scheduler.schedule();
}

defineExpose({ resetView });

watch(
  () => [props.snapshot, props.showCalibrationBoundary],
  () => scheduler.schedule(),
  { deep: true }
);

onMounted(() => {
  scheduler.schedule();
  if (wrapRef.value && typeof ResizeObserver !== 'undefined') {
    resizeObs = new ResizeObserver(() => scheduler.schedule());
    resizeObs.observe(wrapRef.value);
  }
});

onBeforeUnmount(() => {
  scheduler.cancel();
  resizeObs?.disconnect();
});
</script>

<style scoped>
.fusion-topview-wrap {
  width: 100%;
  height: 100%;
  min-height: 410px;
  background: var(--c-canvas);
  border-radius: var(--r-sm);
  overflow: hidden;
}

.fusion-canvas {
  width: 100%;
  height: 100%;
  display: block;
  cursor: grab;
}

.fusion-canvas:active {
  cursor: grabbing;
}
</style>
