<template>
  <div ref="containerRef" class="video-overlay-container">
    <canvas ref="canvasRef" class="video-canvas" />
    <div v-if="!frame" class="video-empty">
      <p class="empty-main">{{ COPY.VISION_STOPPED }}</p>
      <p class="empty-sub">点击「开始检测」或「离线示例」加载道路视觉画面与检测框</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount } from 'vue';
import type { VisionBox, VisionFrame } from '@/types';
import { COPY } from '@/types';
import { RafScheduler } from '@/utils/raf';

const props = defineProps<{
  frame: VisionFrame | null;
  boxes: VisionBox[];
}>();

const containerRef = ref<HTMLDivElement | null>(null);
const canvasRef = ref<HTMLCanvasElement | null>(null);
const loadedImage = ref<HTMLImageElement | null>(null);
let lastSrc = '';
let resizeObs: ResizeObserver | null = null;

function getColors() {
  const s = getComputedStyle(document.documentElement);
  return {
    canvas: s.getPropertyValue('--c-canvas').trim(),
    cls0: s.getPropertyValue('--c-cls-0').trim(),
    clsVehicle: s.getPropertyValue('--c-cls-2').trim(),
    surface: s.getPropertyValue('--c-surface').trim()
  };
}

function draw(): void {
  const canvas = canvasRef.value;
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const dpr = window.devicePixelRatio || 1;
  const cw = canvas.clientWidth || 720;
  const ch = canvas.clientHeight || 420;
  if (canvas.width !== Math.round(cw * dpr) || canvas.height !== Math.round(ch * dpr)) {
    canvas.width = Math.round(cw * dpr);
    canvas.height = Math.round(ch * dpr);
  }

  ctx.save();
  ctx.scale(dpr, dpr);
  const colors = getColors();
  ctx.fillStyle = colors.canvas;
  ctx.fillRect(0, 0, cw, ch);

  if (!props.frame || !loadedImage.value) {
    ctx.restore();
    return;
  }

  // Aspect-ratio preserving fit (letterbox without cropping)
  const iw = loadedImage.value.naturalWidth || 1280;
  const ih = loadedImage.value.naturalHeight || 720;
  const scale = Math.min(cw / iw, ch / ih);
  const dw = iw * scale;
  const dh = ih * scale;
  const dx = (cw - dw) * 0.5;
  const dy = (ch - dh) * 0.5;

  ctx.drawImage(loadedImage.value, dx, dy, dw, dh);

  // Draw detection boxes (2px stroke, class-colored, top label 'label 0.87')
  for (const b of props.boxes) {
    const bx = dx + b.x * dw;
    const by = dy + b.y * dh;
    const bw = b.w * dw;
    const bh = b.h * dh;
    const color = b.classId === 0 ? colors.cls0 : colors.clsVehicle;

    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.strokeRect(bx, by, bw, bh);

    const labelText = `${b.label} ${b.score.toFixed(2)}`;
    ctx.font = '600 11px sans-serif';
    const textW = ctx.measureText(labelText).width + 8;
    const labelY = Math.max(dy + 16, by);

    ctx.fillStyle = color;
    ctx.fillRect(bx, labelY - 16, textW, 16);
    ctx.fillStyle = colors.canvas;
    ctx.fillText(labelText, bx + 4, labelY - 4);
  }

  ctx.restore();
}

const scheduler = new RafScheduler(draw);

function ensureImage(url: string): void {
  if (!url) return;
  if (url === lastSrc && loadedImage.value) {
    scheduler.schedule();
    return;
  }
  lastSrc = url;
  const img = new Image();
  img.onload = () => {
    loadedImage.value = img;
    scheduler.schedule();
  };
  img.src = url;
}

watch(
  () => [props.frame, props.boxes],
  () => {
    if (props.frame?.previewDataUrl) {
      ensureImage(props.frame.previewDataUrl);
    } else {
      scheduler.schedule();
    }
  },
  { deep: true }
);

onMounted(() => {
  if (props.frame?.previewDataUrl) {
    ensureImage(props.frame.previewDataUrl);
  }
  if (containerRef.value && typeof ResizeObserver !== 'undefined') {
    resizeObs = new ResizeObserver(() => scheduler.schedule());
    resizeObs.observe(containerRef.value);
  }
});

onBeforeUnmount(() => {
  scheduler.cancel();
  resizeObs?.disconnect();
});
</script>

<style scoped>
.video-overlay-container {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 420px;
  background: var(--c-canvas);
  border-radius: var(--r-sm);
  overflow: hidden;
}

.video-canvas {
  width: 100%;
  height: 100%;
  display: block;
}

.video-empty {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: var(--c-ink-3);
  pointer-events: none;
}

.empty-main {
  font-size: var(--fs-body);
  font-weight: 600;
}

.empty-sub {
  margin-top: var(--sp-1);
  font-size: var(--fs-cap);
  opacity: 0.8;
}
</style>
