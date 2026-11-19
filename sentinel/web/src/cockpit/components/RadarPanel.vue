<script setup lang="ts">
import { ref } from 'vue';
import type { Target } from '../types';
import { useSceneStore } from '../stores/scene';
import { useCanvas } from '../composables/useCanvas';
import { diamond, label, line, targetColor } from '../core/drawing';
import PanelHeader from './PanelHeader.vue';
const props = defineProps<{ targets: Target[]; time: number }>();
const store = useSceneStore();
const canvas = ref<HTMLCanvasElement | null>(null);
let hits: { id: string; x: number; y: number }[] = [];
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
useCanvas(canvas, (ctx, w, h) => {
  ctx.clearRect(0, 0, w, h);
  const cx = w / 2,
    cy = h / 2 + 3,
    radius = Math.min(w / 2 - 48, h / 2 - 35);
  const toPoint = (x: number, y: number) => [cx + (x / 200) * radius, cy - (y / 200) * radius];
  for (let x = 0; x < w; x += 28) line(ctx, x, 0, x, h, '#28463a16');
  for (let y = 0; y < h; y += 28) line(ctx, 0, y, w, y, '#28463a16');
  const glow = ctx.createRadialGradient(cx, cy, 10, cx, cy, radius);
  glow.addColorStop(0, '#17392b35');
  glow.addColorStop(1, '#0d231b10');
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fill();
  for (let k = 1; k <= 4; k++) {
    ctx.beginPath();
    ctx.arc(cx, cy, (radius * k) / 4, 0, Math.PI * 2);
    ctx.strokeStyle = k === 4 ? '#4f9a7155' : '#6aaf8528';
    ctx.lineWidth = 1;
    ctx.stroke();
    label(ctx, `${k * 50} m`, cx + 8, cy - (radius * k) / 4 + 13, '#719785', 10);
  }
  for (let degree = 0; degree < 360; degree += 5) {
    const angle = ((degree - 90) * Math.PI) / 180,
      major = degree % 30 === 0;
    const r2 = radius + (major ? 8 : 4);
    line(
      ctx,
      cx + radius * Math.cos(angle),
      cy + radius * Math.sin(angle),
      cx + r2 * Math.cos(angle),
      cy + r2 * Math.sin(angle),
      major ? '#77a58e80' : '#496b5560',
    );
    if (major) {
      line(ctx, cx, cy, cx + radius * Math.cos(angle), cy + radius * Math.sin(angle), '#5b8b6c24');
      label(
        ctx,
        degree === 0 ? 'N / 0°' : `${degree}°`,
        cx + (radius + 23) * Math.cos(angle),
        cy + (radius + 23) * Math.sin(angle) + 4,
        degree === 0 ? '#b9e7ca' : '#648876',
        11,
        'center',
      );
    }
  }
  const scan = reduced.matches ? -0.8 : props.time * 0.58 - Math.PI / 2;
  // 分段扇形产生渐退余晖，不使用整屏叠加导致残影积累。
  for (let k = 0; k < 45; k++) {
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, radius, scan - (k + 1) * 0.018, scan - k * 0.018);
    ctx.closePath();
    ctx.fillStyle = `rgba(81,218,146,${0.11 * (1 - k / 45)})`;
    ctx.fill();
  }
  line(ctx, cx, cy, cx + Math.cos(scan) * radius, cy + Math.sin(scan) * radius, '#85f3b489', 1.2);
  for (let k = 0; k < 52; k++) {
    const a = k * 2.3999,
      r = Math.sqrt(((k * 71) % 97) / 97) * radius;
    const d = (scan - a + Math.PI * 20) % (Math.PI * 2);
    ctx.fillStyle = `rgba(91,211,151,${Math.max(0.02, 0.32 - d * 0.12)})`;
    ctx.fillRect(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 2, 2);
  }
  hits = [];
  for (const target of props.targets) {
    if (!target.radar || !target.fusion) continue;
    const [x, y] = toPoint(target.fusion.x, target.fusion.y);
    const selected = store.selectedId === target.id,
      color = targetColor(target, selected);
    hits.push({ id: target.id, x, y });
    ctx.beginPath();
    target.history?.forEach((p, i) => {
      const [hx, hy] = toPoint(p.x, p.y);
      if (i === 0) ctx.moveTo(hx, hy);
      else ctx.lineTo(hx, hy);
    });
    ctx.strokeStyle = `${color}55`;
    ctx.setLineDash([3, 4]);
    ctx.stroke();
    ctx.setLineDash([]);
    diamond(ctx, x, y, selected ? 7 : 5, color);
    if (selected) {
      ctx.beginPath();
      ctx.arc(x, y, 16 + (reduced.matches ? 0 : Math.sin(props.time * 2) * 2), 0, Math.PI * 2);
      ctx.strokeStyle = '#c2ffe68a';
      ctx.stroke();
      ctx.setLineDash([3, 5]);
      line(ctx, cx, cy, x, y, '#b8eacb45');
      ctx.setLineDash([]);
      line(ctx, x + 18, y - 2, x + 31, y - 15, '#c4f5da90');
      line(ctx, x + 31, y - 15, x + 92, y - 15, '#c4f5da90');
      label(ctx, target.id, x + 35, y - 21, '#d4ffe6', 12);
      label(ctx, `${target.radar.range.toFixed(1)}m`, x + 35, y + 1, '#8cb7a1', 10);
    } else label(ctx, target.id, x + 11, y - 7, color, 11);
  }
  ctx.beginPath();
  ctx.moveTo(cx, cy - 9);
  ctx.lineTo(cx - 6, cy + 6);
  ctx.lineTo(cx, cy + 3);
  ctx.lineTo(cx + 6, cy + 6);
  ctx.closePath();
  ctx.fillStyle = '#a5f4ce';
  ctx.fill();
  label(ctx, 'E', w - 17, cy + 4, '#648876', 10, 'center');
});
function select(event: MouseEvent) {
  const rect = canvas.value!.getBoundingClientRect();
  const x = ((event.clientX - rect.left) / rect.width) * canvas.value!.clientWidth,
    y = ((event.clientY - rect.top) / rect.height) * canvas.value!.clientHeight;
  const hit = hits.find((p) => Math.hypot(x - p.x, y - p.y) < 20);
  if (hit) store.select(hit.id);
}
</script>
<template>
  <section class="hud-panel radar-panel">
    <PanelHeader
      index="01"
      title="雷达探测"
      english="RADAR PPI"
      :status="store.playing ? '扫描中 · 10 Hz' : '扫描已暂停'"
    />
    <div class="radar-body">
      <aside class="instrument-sidebar">
        <div class="eyebrow">SENSOR PARAMETERS</div>
        <h3>雷达参数</h3>
        <dl class="data-list">
          <div>
            <dt>探测半径</dt>
            <dd>200 <small>m</small></dd>
          </div>
          <div>
            <dt>方位覆盖</dt>
            <dd>360 <small>°</small></dd>
          </div>
          <div>
            <dt>距离分辨率</dt>
            <dd>0.25 <small>m</small></dd>
          </div>
          <div>
            <dt>更新频率</dt>
            <dd>10 <small>Hz</small></dd>
          </div>
        </dl>
        <div class="side-divider"></div>
        <div class="eyebrow">TRACK CLASSIFICATION</div>
        <div class="legend-item">
          <i class="dot green"></i>已融合<span>{{
            targets
              .filter((t) => t.radar && t.camera)
              .length.toString()
              .padStart(2, '0')
          }}</span>
        </div>
        <div class="legend-item">
          <i class="dot amber"></i>仅雷达<span>{{
            targets
              .filter((t) => t.radar && !t.camera)
              .length.toString()
              .padStart(2, '0')
          }}</span>
        </div>
        <div class="legend-item">
          <i class="dot cyan"></i>仅视觉<span>{{
            targets
              .filter((t) => !t.radar)
              .length.toString()
              .padStart(2, '0')
          }}</span>
        </div>
        <div class="radar-note">
          <span class="signal-bars">▂▃▅▆▇</span><span>模拟回波信号</span
          ><b>RCS {{ store.selected?.radar?.rcs?.toFixed(2) ?? '—' }}</b>
        </div>
      </aside>
      <div class="canvas-wrap radar-canvas">
        <canvas
          ref="canvas"
          :data-selected-target="store.selectedId"
          @click="select"
          aria-label="雷达目标态势，点击目标可三屏联动"
        ></canvas
        ><span class="canvas-tag top-left">PPI · NORTH UP</span
        ><span class="canvas-tag bottom-right">RANGE 200 m</span>
      </div>
    </div>
  </section>
</template>
