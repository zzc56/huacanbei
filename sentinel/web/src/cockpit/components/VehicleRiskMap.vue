<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue';
import type { VehicleResult } from '../../../../sentinel-backend/src/vehicle/contracts';

const props = defineProps<{ result: VehicleResult | null }>();
const canvas = ref<HTMLCanvasElement>();
let observer: ResizeObserver;

function draw() {
  const el = canvas.value;
  if (!el) return;
  const w = el.clientWidth, h = el.clientHeight, dpr = window.devicePixelRatio || 1;
  const ctx = el.getContext('2d');
  if (!ctx || !w || !h) return;
  el.width = Math.round(w * dpr);
  el.height = Math.round(h * dpr);
  ctx.scale(dpr, dpr);
  const result = props.result, field = result?.field;
  if (!field || !result) return;
  const farthest = Math.max(field.lookAheadM, ...result.obstacles.map(o => o.yM));
  const depth = Math.min(field.height * field.resolution, farthest + 0.25);
  const side = Math.min(-field.xMin, Math.max(0.75, ...result.obstacles.map(o => Math.abs(o.xM) + 0.15)));
  const scale = Math.min((w - 68) / (2 * side), (h - 66) / depth);
  if (scale <= 0) return;
  const x = (m: number) => w / 2 + m * scale, y = (m: number) => h - 40 - m * scale;
  ctx.save();
  ctx.beginPath(); ctx.rect(x(-side), y(depth), side * 2 * scale, depth * scale); ctx.clip();
  ctx.fillStyle = '#e9f2ef';
  ctx.fillRect(x(-side), y(depth), side * 2 * scale, depth * scale);
  for (let row = 0; row < field.height; row++) {
    for (let col = 0; col < field.width; col++) {
      const value = field.values[row * field.width + col];
      if (value < 0.005) continue;
      const intensity = Math.min(1, value);
      ctx.fillStyle = `hsla(${165 - 160 * intensity},72%,48%,${Math.min(0.95, intensity * 2)})`;
      const cell = field.resolution * scale;
      ctx.fillRect(x(field.xMin + col * field.resolution), y(field.yMin + (row + 1) * field.resolution), cell + 0.3, cell + 0.3);
    }
  }
  ctx.strokeStyle = '#b6cec9'; ctx.lineWidth = 0.7;
  ctx.beginPath();
  for (let g = 0; g <= depth; g += 0.25) { ctx.moveTo(x(-side), y(g)); ctx.lineTo(x(side), y(g)); }
  for (let g = Math.ceil(-side * 4) / 4; g <= side; g += 0.25) { ctx.moveTo(x(g), y(0)); ctx.lineTo(x(g), y(depth)); }
  ctx.stroke();
  ctx.strokeStyle = '#34756e'; ctx.setLineDash([5, 4]); ctx.lineWidth = 1.5;
  ctx.strokeRect(x(-field.corridorHalfWidthM), y(field.lookAheadM), 2 * field.corridorHalfWidthM * scale, field.lookAheadM * scale);
  ctx.setLineDash([]);
  for (const o of result.obstacles) {
    ctx.fillStyle = { camera: '#157b92', lidar: '#986126', both: '#563b86' }[o.source];
    ctx.beginPath(); ctx.arc(x(o.xM), y(o.yM), 7, 0, 2 * Math.PI); ctx.fill();
    ctx.strokeStyle = 'white'; ctx.lineWidth = 2; ctx.stroke();
  }
  ctx.restore();
  ctx.fillStyle = '#36535b'; ctx.font = '12px sans-serif'; ctx.textAlign = 'right';
  for (let m = 0; m <= depth; m += 0.5) ctx.fillText(m + ' m', x(-side) - 5, y(m) + 4);
  ctx.fillStyle = '#194d54'; ctx.beginPath(); ctx.moveTo(x(0), y(0) - 9);
  ctx.lineTo(x(0) - 8, y(0) + 7); ctx.lineTo(x(0) + 8, y(0) + 7); ctx.closePath(); ctx.fill();
  ctx.textAlign = 'center'; ctx.fillText('车身原点 · 前进方向 ↑', x(0), y(0) + 26);
}
onMounted(() => {
  observer = new ResizeObserver(draw);
  if (canvas.value) observer.observe(canvas.value);
  draw();
});
watch(() => props.result, draw, { flush: 'post' });
onUnmounted(() => observer?.disconnect());
</script>

<template>
  <div class="vehicle-plot">
    <canvas ref="canvas" aria-label="车身坐标下的风险热图与融合障碍位置" />
    <p v-if="!result?.field">等待有效位姿和雷达观测</p>
  </div>
</template>
<style scoped>
.vehicle-plot {position:relative; background:#f6faf8; border-radius:10px; overflow:hidden}
canvas {display:block; width:100%; height:clamp(260px,42vh,450px)}
p {position:absolute; inset:0; display:grid; place-items:center; color:#586d72}
</style>
