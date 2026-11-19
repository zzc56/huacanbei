<template>
  <div
    ref="wrapRef"
    class="scatter-wrap"
    :title="interactive ? COPY.TOOLTIP_SCATTER : undefined"
  >
    <canvas
      ref="canvasRef"
      class="scatter-canvas"
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
import type { RadarTarget } from '@/types';
import { COPY } from '@/types';
import {
  createDefaultTransform,
  zoomAtPoint,
  worldToScreen,
  type ViewportTransform
} from '@/utils/coords';
import { RafScheduler } from '@/utils/raf';

const props = withDefaults(
  defineProps<{
    targets: RadarTarget[];
    halfWidth?: number;
    maxLength?: number;
    interactive?: boolean;
  }>(),
  {
    halfWidth: 20,
    maxLength: 100,
    interactive: true
  }
);

const wrapRef = ref<HTMLDivElement | null>(null);
const canvasRef = ref<HTMLCanvasElement | null>(null);
const transform = ref<ViewportTransform>(createDefaultTransform());
const dragging = ref(false);
const dragStart = ref({ x: 0, y: 0, ox: 0, oy: 0 });
let resizeObs: ResizeObserver | null = null;

function getThemeColors() {
  const style = getComputedStyle(document.documentElement);
  return {
    canvas: style.getPropertyValue('--c-canvas').trim(),
    grid: style.getPropertyValue('--c-grid').trim(),
    axis: style.getPropertyValue('--c-axis').trim(),
    ink3: style.getPropertyValue('--c-ink-3').trim(),
    teal: style.getPropertyValue('--c-teal').trim(),
    amber: style.getPropertyValue('--c-amber').trim()
  };
}

function draw(): void {
  const canvas = canvasRef.value;
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const dpr = window.devicePixelRatio || 1;
  const width = canvas.clientWidth || 640;
  const height = canvas.clientHeight || 420;
  if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
  }
  ctx.save();
  ctx.scale(dpr, dpr);

  const colors = getThemeColors();
  ctx.fillStyle = colors.canvas;
  ctx.fillRect(0, 0, width, height);

  // Inner padding L53 T24 R21 B47 per specification
  const padL = 53;
  const padT = 24;
  const padR = 21;
  const padB = 47;
  const plotW = Math.max(80, width - padL - padR);
  const plotH = Math.max(80, height - padT - padB);
  const bounds = {
    left: padL,
    top: padT,
    right: padL + plotW,
    bottom: padT + plotH,
    width: plotW,
    height: plotH
  };

  const hw = Math.max(5, Math.min(200, props.halfWidth));
  const len = Math.max(10, Math.min(1000, props.maxLength));
  const range = { xMin: -hw, xMax: hw, yMin: 0, yMax: len };

  // Apply whole-canvas zoom & pan transform around plot center
  const cx = bounds.left + bounds.width * 0.5;
  const cy = bounds.top + bounds.height * 0.5;
  ctx.save();
  ctx.translate(cx + transform.value.offsetX, cy + transform.value.offsetY);
  ctx.scale(transform.value.scale, transform.value.scale);
  ctx.translate(-cx, -cy);

  // 8 vertical grid lines (index 4 = 5th line is center axis --c-axis)
  for (let i = 0; i < 8; i++) {
    const ratio = i / 7;
    const gx = bounds.left + ratio * bounds.width;
    ctx.beginPath();
    ctx.strokeStyle = i === 4 ? colors.axis : colors.grid;
    ctx.lineWidth = i === 4 ? 1.4 : 1;
    ctx.moveTo(gx, bounds.top);
    ctx.lineTo(gx, bounds.bottom);
    ctx.stroke();

    const xVal = -hw + ratio * (2 * hw);
    ctx.fillStyle = colors.ink3;
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(xVal.toFixed(0), gx, bounds.bottom + 14);
  }

  // 5 horizontal grid lines
  for (let j = 0; j < 5; j++) {
    const ratio = j / 4;
    const gy = bounds.bottom - ratio * bounds.height;
    ctx.beginPath();
    ctx.strokeStyle = colors.grid;
    ctx.lineWidth = 1;
    ctx.moveTo(bounds.left, gy);
    ctx.lineTo(bounds.right, gy);
    ctx.stroke();

    const yVal = ratio * len;
    ctx.fillStyle = colors.ink3;
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(yVal.toFixed(0), bounds.left - 8, gy + 3);
  }

  // Axis Titles
  ctx.fillStyle = colors.ink3;
  ctx.font = '11px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('Y 纵向 (m)', bounds.left, bounds.top - 8);
  ctx.textAlign = 'center';
  ctx.fillText('X 横向 (m)', bounds.left + bounds.width * 0.5, bounds.bottom + 32);

  // Filter targets within world range
  const inView = props.targets.filter(
    (t) => t.x >= -hw && t.x <= hw && t.y >= 0 && t.y <= len
  );

  // Draw targets
  for (const t of inView) {
    const { sx, sy } = worldToScreen(t.x, t.y, range, bounds);
    const color = t.cls === 0 ? colors.teal : colors.amber;

    // Glow circle r=12 (30% alpha)
    ctx.save();
    ctx.globalAlpha = 0.3;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(sx, sy, 12, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Solid circle r=5
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(sx, sy, 5, 0, Math.PI * 2);
    ctx.fill();

    // Label 'ID n' on the right
    ctx.fillStyle = colors.ink3;
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`ID ${t.id}`, sx + 8, sy + 4);
  }

  ctx.restore();

  // Overlay top-left count or centered empty state
  ctx.fillStyle = colors.ink3;
  ctx.font = '12px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(`视图内 ${inView.length} 个目标`, padL + 8, padT + 18);

  if (props.targets.length === 0) {
    ctx.textAlign = 'center';
    ctx.fillStyle = colors.ink3;
    ctx.font = '600 13px sans-serif';
    ctx.fillText('尚无目标事件', width * 0.5, height * 0.5 - 6);
    ctx.font = '11px sans-serif';
    ctx.fillText('连接后，接收到的车辆目标会显示在这里', width * 0.5, height * 0.5 + 14);
  }

  ctx.restore();
}

const scheduler = new RafScheduler(draw);

function onWheel(ev: WheelEvent): void {
  if (!props.interactive || !canvasRef.value) return;
  const rect = canvasRef.value.getBoundingClientRect();
  const cursorX = ev.clientX - rect.left;
  const cursorY = ev.clientY - rect.top;
  const factor = ev.deltaY < 0 ? 1.15 : 1 / 1.15;
  transform.value = zoomAtPoint(
    transform.value,
    factor,
    cursorX,
    cursorY,
    rect.width * 0.5,
    rect.height * 0.5
  );
  scheduler.schedule();
}

function onMouseDown(ev: MouseEvent): void {
  if (!props.interactive || ev.button !== 0) return;
  dragging.value = true;
  dragStart.value = {
    x: ev.clientX,
    y: ev.clientY,
    ox: transform.value.offsetX,
    oy: transform.value.offsetY
  };
}

function onMouseMove(ev: MouseEvent): void {
  if (!props.interactive || !dragging.value) return;
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
  if (!props.interactive) return;
  transform.value = createDefaultTransform();
  scheduler.schedule();
}

defineExpose({ resetView });

watch(
  () => [props.targets, props.halfWidth, props.maxLength],
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
.scatter-wrap {
  width: 100%;
  height: 100%;
  min-height: 440px;
  background: var(--c-canvas);
  border-radius: var(--r-sm);
  overflow: hidden;
  position: relative;
}

.scatter-canvas {
  width: 100%;
  height: 100%;
  display: block;
  cursor: grab;
}

.scatter-canvas:active {
  cursor: grabbing;
}
</style>
