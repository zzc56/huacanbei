<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue';
import type { VehicleResult } from '../../../../sentinel-backend/src/vehicle/contracts';
import { contourPath } from '../core/contours';
import { paintFieldCell } from '../core/fieldColors';

const props = defineProps<{ result: VehicleResult | null; corridor: boolean; contours: boolean }>();
const canvas = ref<HTMLCanvasElement>();
const heat = document.createElement('canvas');
let observer: ResizeObserver;
const marks = {
  camera: { color: '#1976a0', label: '视觉目标' },
  lidar: { color: '#9c641d', label: '雷达目标' },
  both: { color: '#087b7d', label: '双源目标' },
};

function draw() {
  const el = canvas.value, result = props.result, field = result?.field;
  const ctx = el?.getContext('2d');
  if (!el || !ctx || !el.clientWidth || !el.clientHeight) return;
  const w = el.clientWidth, h = el.clientHeight, dpr = window.devicePixelRatio || 1;
  el.width = Math.round(w * dpr);
  el.height = Math.round(h * dpr);
  ctx.scale(dpr, dpr);
  if (!field || !result) return;

  // Equal metre scales on both axes. Extra room shows more of the computed grid.
  const farthest = Math.max(field.lookAheadM, ...result.obstacles.map(o => o.yM));
  const depth = Math.min(field.height * field.resolution, farthest + 0.25);
  const halfWidth = Math.min(-field.xMin, Math.max(0.66, ...result.obstacles.map(o => Math.abs(o.xM) + 0.12)));
  const scale = Math.min((w - 74) / (2 * halfWidth), (h - 90) / depth);
  if (scale <= 0) return;
  const side = Math.min(-field.xMin, (w - 74) / (2 * scale));
  const x = (m: number) => w / 2 + m * scale, y = (m: number) => h - 54 - m * scale;
  const cell = field.resolution * scale;
  const left = x(-side), right = x(side), top = y(depth), bottom = y(0);
  ctx.save();
  ctx.beginPath(); ctx.rect(left, top, right - left, bottom - top); ctx.clip();
  ctx.fillStyle = '#f2f9fb'; ctx.fillRect(left, top, right - left, bottom - top);
  heat.width = field.width; heat.height = field.height;
  const raster = heat.getContext('2d')!;
  const image = raster.createImageData(field.width, field.height);
  field.values.forEach((v, i) => paintFieldCell(image.data, i * 4, v));
  raster.putImageData(image, 0, 0);
  ctx.save();
  ctx.translate(x(field.xMin), y(field.yMin)); ctx.scale(cell, -cell);
  ctx.drawImage(heat, 0, 0);
  if (props.contours) {
    const values = Float32Array.from(field.values);
    ctx.translate(0.5, 0.5);
    for (const level of [0.025, 0.05, 0.10, 0.20, 0.30, 0.45, 0.60, 0.75, 0.90]) {
      ctx.strokeStyle = level >= 0.45 ? '#ad7750' : '#519d9b';
      ctx.lineWidth = (level >= 0.2 ? 1.15 : 0.75) / cell;
      ctx.stroke(contourPath(values, field.width, field.height, level));
    }
  }
  ctx.restore();

  ctx.beginPath(); ctx.strokeStyle = '#9ac2d14a'; ctx.lineWidth = 1;
  for (let i = Math.ceil(-side * 4); i <= side * 4; i++) {
    ctx.moveTo(x(i / 4), top); ctx.lineTo(x(i / 4), bottom);
  }
  for (let i = 0; i <= depth * 4; i++) {
    ctx.moveTo(left, y(i / 4)); ctx.lineTo(right, y(i / 4));
  }
  ctx.stroke();
  if (props.corridor) {
    const half = field.corridorHalfWidthM;
    ctx.fillStyle = '#10999c0a';
    ctx.fillRect(x(-half), y(field.lookAheadM), half * 2 * scale, field.lookAheadM * scale);
    ctx.setLineDash([6, 5]); ctx.strokeStyle = '#348e98'; ctx.lineWidth = 1.4;
    ctx.strokeRect(x(-half), y(field.lookAheadM), half * 2 * scale, field.lookAheadM * scale);
    ctx.setLineDash([]);
  }
  ctx.restore();
  ctx.font = '11px "Segoe UI", sans-serif'; ctx.fillStyle = '#41657c'; ctx.textAlign = 'right';
  for (let i = 0; i <= depth * 2; i++) ctx.fillText((i / 2).toFixed(1), left - 7, y(i / 2) + 4);
  ctx.textAlign = 'center';
  for (let i = Math.ceil(-side * 2); i <= side * 2; i++) {
    if (i !== 0) ctx.fillText((i / 2).toFixed(1), x(i / 2), bottom + 18);
  }
  ctx.textAlign = 'left';
  ctx.fillText('前向 Y (m)', left, top - 10);
  ctx.textAlign = 'right'; ctx.fillText('横向 X (m)', right, bottom + 37);

  // The glyph indicates the vehicle reference point; its size is in screen pixels.
  ctx.save(); ctx.translate(x(0), bottom);
  ctx.fillStyle = '#0e475e';
  ctx.beginPath(); ctx.moveTo(0, -8); ctx.lineTo(5, -2); ctx.lineTo(-5, -2); ctx.closePath(); ctx.fill();
  ctx.fillRect(-9, 4, 3, 6); ctx.fillRect(6, 4, 3, 6); ctx.fillRect(-9, 15, 3, 6); ctx.fillRect(6, 15, 3, 6);
  ctx.beginPath(); ctx.roundRect(-6, 0, 12, 24, 3); ctx.fill();
  ctx.fillStyle = '#a4dddd'; ctx.fillRect(-4, 5, 8, 5);
  ctx.fillStyle = '#204963'; ctx.textAlign = 'center'; ctx.fillText('车身原点', 0, 39);
  ctx.restore();

  for (const o of result.obstacles) {
    if (Math.abs(o.xM) > side || o.yM < 0 || o.yM > depth) continue;
    const mx = x(o.xM), my = y(o.yM), mark = marks[o.source];
    ctx.fillStyle = '#ffffffdd'; ctx.strokeStyle = mark.color; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.arc(mx, my, 8, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.arc(mx, my, 3.5, 0, 2 * Math.PI); ctx.fillStyle = mark.color; ctx.fill();
    if (result.obstacles.length === 1) {
      ctx.font = '600 12px "Microsoft YaHei", sans-serif';
      const label = mark.label + ' · ' + o.yM.toFixed(2) + ' m';
      const width = ctx.measureText(label).width + 14;
      const lx = Math.max(6, Math.min(mx + 16, w - width - 6)), ly = Math.max(21, my - 17);
      ctx.fillStyle = '#f8ffffef'; ctx.strokeStyle = '#9cc6d2'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.roundRect(lx, ly - 12, width, 23, 4); ctx.fill(); ctx.stroke();
      ctx.textAlign = 'left'; ctx.fillStyle = '#194f61'; ctx.fillText(label, lx + 7, ly + 4);
    }
  }
}
onMounted(() => {
  observer = new ResizeObserver(draw);
  if (canvas.value) observer.observe(canvas.value);
  draw();
});
watch(() => [props.result, props.corridor, props.contours], draw, { flush: 'post' });
onUnmounted(() => observer?.disconnect());
</script>

<template>
  <div class="scene-viewport vehicle-plot">
    <canvas ref="canvas" aria-label="车身坐标下的风险热图与融合障碍位置" />
    <p v-if="!result?.field" class="plot-empty">等待有效位姿和雷达观测</p>
  </div>
</template>

<style scoped>
.vehicle-plot {
  flex: 1;
  min-height: 290px;
  background: radial-gradient(ellipse at 50% 75%, #ecf8f8, #f5fbfe 80%);
}
.vehicle-plot canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
.plot-empty { position: absolute; inset: 0; display: grid; place-items: center; font-size: 14px; color: #41657c; }
</style>
