<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useSceneStore } from '../stores/scene';
import type { Target } from '../types';
import { useCanvas } from '../composables/useCanvas';
import { riskColor, riskGrid, riskParams } from '../core/risk';
import { contourPath } from '../core/contours';
import { diamond, label, line, targetColor } from '../core/drawing';
import PanelHeader from './PanelHeader.vue';
const props = defineProps<{ targets: Target[]; time: number }>();
const store = useSceneStore(),
  canvas = ref<HTMLCanvasElement | null>(null),
  hover = ref<{ x: number; y: number; risk: number; range: number } | null>(null);
const contourVisible = ref(true),
  trailsVisible = ref(true);
const heatCanvas = document.createElement('canvas');
heatCanvas.width = riskGrid.width;
heatCanvas.height = riskGrid.height;
const heatCtx = heatCanvas.getContext('2d')!;
let worker: Worker | undefined,
  values = new Float32Array(riskGrid.width * riskGrid.height),
  contours: Path2D[] = [],
  contributionPath = new Path2D(),
  contributionId = '',
  busy = false,
  queued = false,
  disposed = false;
const thresholds = [0.15, 0.3, 0.45, 0.6, 0.75, 0.85];
let hits: { x: number; y: number; id: string }[] = [];
let geometry = { w: 1, h: 1, cx: 0, cy: 0, sx: 1, sy: 1, shear: 0 };
const selectedRisk = computed(() => store.selected?.risk?.value ?? 0);
function requestField() {
  if (!worker || disposed) return;
  if (busy) {
    queued = true;
    return;
  }
  busy = true;
  worker.postMessage({
    targets: store.frame.targets,
    grid: riskGrid,
    params: riskParams,
    selectedId: store.selectedId,
  });
}
onMounted(() => {
  worker = new Worker(new URL('../core/risk.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (event) => {
    // 暂停后不提交在途旧计算；仍允许用户主动切换目标时更新贡献边界。
    if (
      event.data.selectedId !== store.selectedId ||
      (!store.playing && event.data.selectedId === contributionId)
    ) {
      busy = false;
      if (queued) {
        queued = false;
        requestField();
      }
      return;
    }
    values = event.data.values;
    const image = heatCtx.createImageData(riskGrid.width, riskGrid.height);
    for (let i = 0; i < values.length; i++) {
      const [r, g, b] = riskColor(values[i]);
      image.data.set([r, g, b, Math.round(115 + values[i] * 85)], i * 4);
    }
    heatCtx.putImageData(image, 0, 0);
    contours = thresholds.map((threshold) =>
      contourPath(values, riskGrid.width, riskGrid.height, threshold),
    );
    contributionPath = contourPath(event.data.contribution, riskGrid.width, riskGrid.height, 0.12);
    contributionId = event.data.selectedId;
    busy = false;
    if (queued) {
      queued = false;
      requestField();
    }
  };
  requestField();
});
watch(() => [store.frame.timestamp, store.selectedId], requestField);
onUnmounted(() => {
  disposed = true;
  worker?.terminate();
});
function map(x: number, y: number) {
  return [geometry.cx + x * geometry.sx + y * geometry.shear, geometry.cy - y * geometry.sy];
}
useCanvas(canvas, (ctx, w, h) => {
  ctx.clearRect(0, 0, w, h);
  geometry = {
    w,
    h,
    cx: w * 0.48,
    cy: h * 0.51,
    sx: (w * 0.405) / 200,
    sy: (h * 0.4) / 200,
    shear: (w * 0.062) / 200,
  };
  const polygon = (points: number[][], fill: string, stroke?: string) => {
    ctx.beginPath();
    points.forEach((p, i) => {
      const [x, y] = map(p[0], p[1]);
      if (!i) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.stroke();
    }
  };
  polygon(
    [
      [-200, -200],
      [200, -200],
      [200, 200],
      [-200, 200],
    ],
    '#0c1b1a',
    '#35645355',
  );
  // 程序化地面轮廓：道路、建筑与植被，保持风险场为二维标量场。
  for (let i = 0; i < 55; i++) {
    const x = (Math.sin(i * 54.32) * 0.5 + 0.5) * 340 - 170,
      y = (Math.sin(i * 21.41) * 0.5 + 0.5) * 340 - 170;
    if (Math.abs(x) < 30 || Math.abs(y - 40) < 24) continue;
    const size = 8 + (i % 4) * 3;
    polygon(
      [
        [x, y],
        [x + size, y],
        [x + size, y + size],
        [x, y + size],
      ],
      '#172c26',
      '#43674d24',
    );
    polygon(
      [
        [x, y + size],
        [x + size, y + size],
        [x + size - 2, y + size + 5],
        [x - 2, y + size + 5],
      ],
      '#21392e',
    );
  }
  polygon(
    [
      [-23, -200],
      [23, -200],
      [23, 200],
      [-23, 200],
    ],
    '#2f403640',
  );
  polygon(
    [
      [-200, 26],
      [200, 26],
      [200, 54],
      [-200, 54],
    ],
    '#2f403640',
  );
  ctx.save();
  // 网格坐标 → 局部世界坐标 → 倾斜地平面的仿射映射。
  const { cx, cy, sx, sy, shear } = geometry,
    dx = 400 / (riskGrid.width - 1),
    dy = 400 / (riskGrid.height - 1);
  ctx.transform(sx * dx, 0, -shear * dy, sy * dy, cx - 200 * sx + 200 * shear, cy - 200 * sy);
  ctx.imageSmoothingEnabled = true;
  ctx.globalAlpha = 0.86;
  ctx.drawImage(heatCanvas, 0, 0, riskGrid.width - 1, riskGrid.height - 1);
  ctx.globalAlpha = 1;
  if (contourVisible.value) {
    contours.forEach((path, i) => {
      ctx.strokeStyle = [
        '#6fbcdb50',
        '#69d3be65',
        '#a2d19a75',
        '#eddf9a85',
        '#ffe4af9a',
        '#ffe1b0b0',
      ][i];
      ctx.lineWidth = 0.19;
      ctx.stroke(path);
    });
  }
  if (contributionId === store.selectedId) {
    ctx.setLineDash([1.2, 1]);
    ctx.strokeStyle = '#d5fceba0';
    ctx.lineWidth = 0.28;
    ctx.stroke(contributionPath);
    ctx.setLineDash([]);
  }
  ctx.restore();
  for (let x = -200; x <= 200; x += 25) {
    const a = map(x, -200),
      b = map(x, 200);
    line(ctx, a[0], a[1], b[0], b[1], x === 0 ? '#99d4ac30' : '#80b6a011');
  }
  for (let y = -200; y <= 200; y += 25) {
    const a = map(-200, y),
      b = map(200, y);
    line(ctx, a[0], a[1], b[0], b[1], y === 0 ? '#99d4ac30' : '#80b6a011');
  }
  for (let x = -200; x <= 200; x += 100) {
    const [px, py] = map(x, -200);
    label(ctx, `${x}`, px, py + 17, '#526f60', 10, 'center');
  }
  for (let y = -100; y <= 200; y += 100) {
    const [px, py] = map(-200, y);
    label(ctx, `${y}m`, px - 12, py + 3, '#526f60', 10, 'right');
  }
  const [ox, oy] = map(0, 0),
    north = map(0, 185),
    west = map(-100, 160),
    east = map(100, 160);
  ctx.setLineDash([4, 5]);
  line(ctx, ox, oy, north[0], north[1], '#c1e5ce73');
  line(ctx, ox, oy, west[0], west[1], '#81b5a132');
  line(ctx, ox, oy, east[0], east[1], '#81b5a132');
  ctx.setLineDash([]);
  label(ctx, 'N', north[0], north[1] - 10, '#c1e7cf', 11, 'center');
  hits = [];
  // 选中目标最后绘制，标签不会被其他航迹遮挡。
  for (const target of [...props.targets].sort(
    (a, b) => Number(a.id === store.selectedId) - Number(b.id === store.selectedId),
  )) {
    if (!target.fusion) continue;
    const [x, y] = map(target.fusion.x, target.fusion.y),
      selected = store.selectedId === target.id,
      color = targetColor(target, selected);
    hits.push({ id: target.id, x, y });
    if (trailsVisible.value) {
      ctx.beginPath();
      target.history?.forEach((p, i) => {
        const [a, b] = map(p.x, p.y);
        if (!i) ctx.moveTo(a, b);
        else ctx.lineTo(a, b);
      });
      ctx.setLineDash([3, 4]);
      ctx.strokeStyle = `${color}45`;
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (selected) {
      ctx.beginPath();
      ctx.ellipse(x, y, 22, 11, 0, 0, Math.PI * 2);
      ctx.strokeStyle = '#e0ffdeb0';
      ctx.stroke();
      line(ctx, x, y, x, y - 25, '#d9f7dd90');
    }
    diamond(ctx, x, y - (selected ? 25 : 0), selected ? 6 : 4, color);
    const textY = y - (selected ? 52 : 28),
      textX = x + (selected ? 42 : 12);
    ctx.fillStyle = selected ? '#18352bf2' : '#071b16c9';
    ctx.fillRect(textX - 4, textY - 13, 78, 36);
    ctx.strokeStyle = selected ? '#a9dbab78' : '#6f9a7c30';
    ctx.strokeRect(textX - 4, textY - 13, 78, 36);
    label(ctx, target.id, textX + 2, textY, color, 11);
    label(
      ctx,
      (target.risk?.value ?? 0).toFixed(2),
      textX + 2,
      textY + 15,
      (target.risk?.value ?? 0) >= 0.75 ? '#f1bd8e' : '#88cdb3',
      11,
    );
    if ((target.risk?.value ?? 0) > 0.5 && contourVisible.value) {
      const [lx, ly] = map(target.fusion.x + 22, target.fusion.y + 20);
      label(ctx, '0.4', lx, ly, '#d5d5a291', 9);
    }
  }
  ctx.beginPath();
  ctx.moveTo(ox, oy - 9);
  ctx.lineTo(ox - 7, oy + 7);
  ctx.lineTo(ox, oy + 3);
  ctx.lineTo(ox + 7, oy + 7);
  ctx.closePath();
  ctx.fillStyle = '#ddffea';
  ctx.fill();
  label(ctx, 'EGO', ox, oy + 24, '#9cbba7', 10, 'center');
  label(ctx, 'LOCAL ENU / METERS', w - 17, h - 12, '#4d7462', 9, 'right');
});
function pointer(event: MouseEvent, click = false) {
  const rect = canvas.value!.getBoundingClientRect(),
    x = ((event.clientX - rect.left) / rect.width) * geometry.w,
    y = ((event.clientY - rect.top) / rect.height) * geometry.h;
  if (click) {
    const hit = hits.find(
      (p) =>
        Math.hypot(x - p.x, y - p.y) < 25 ||
        (x > p.x + 8 && x < p.x + 90 && y > p.y - 65 && y < p.y),
    );
    if (hit) store.select(hit.id);
    return;
  }
  const wy = (geometry.cy - y) / geometry.sy,
    wx = (x - geometry.cx - wy * geometry.shear) / geometry.sx;
  if (Math.abs(wx) > 200 || Math.abs(wy) > 200) {
    hover.value = null;
    return;
  }
  const col = Math.round(((wx + 200) / 400) * (riskGrid.width - 1)),
    row = Math.round(((200 - wy) / 400) * (riskGrid.height - 1));
  hover.value = {
    x: Math.min(x + 15, geometry.w - 165),
    y: Math.max(0, y - 55),
    risk: values[row * riskGrid.width + col],
    range: Math.hypot(wx, wy),
  };
}
</script>
<template>
  <section class="hud-panel risk-panel">
    <PanelHeader
      index="03"
      title="实时风险场"
      english="REAL-TIME RISK FIELD"
      status="融合解算 · 10 Hz"
    />
    <div class="risk-body">
      <aside class="instrument-sidebar risk-sidebar">
        <div class="eyebrow">RISK DISTRIBUTION</div>
        <h3>空间风险分布</h3>
        <div class="color-legend">
          <div class="color-ramp"></div>
          <div>
            <p><b>高风险</b><span>0.80 — 1.00</span></p>
            <p><b>中高风险</b><span>0.60 — 0.80</span></p>
            <p><b>中低风险</b><span>0.40 — 0.60</span></p>
            <p><b>低风险</b><span>0.00 — 0.40</span></p>
          </div>
        </div>
        <div class="side-divider"></div>
        <dl class="data-list">
          <div>
            <dt>场域网格</dt>
            <dd>128 × 96</dd>
          </div>
          <div>
            <dt>覆盖范围</dt>
            <dd>±200 <small>m</small></dd>
          </div>
          <div>
            <dt>坐标系统</dt>
            <dd>LOCAL ENU</dd>
          </div>
        </dl>
        <div class="model-caption">示意风险模型<span>DEMO MODEL / 可替换公式</span></div>
      </aside>
      <div class="canvas-wrap field-canvas">
        <canvas
          ref="canvas"
          :data-selected-target="store.selectedId"
          @click="pointer($event, true)"
          @mousemove="pointer($event)"
          @mouseleave="hover = null"
          aria-label="实时二维风险场热力图与等高线，点击目标可选中"
        ></canvas>
        <div class="field-overlay">
          <span class="canvas-tag">2D SCALAR FIELD</span>
          <div class="field-layer-controls">
            <button
              :aria-pressed="contourVisible"
              :class="{ active: contourVisible }"
              @click="contourVisible = !contourVisible"
            >
              等高线</button
            ><button
              :aria-pressed="trailsVisible"
              :class="{ active: trailsVisible }"
              @click="trailsVisible = !trailsVisible"
            >
              航迹
            </button>
          </div>
        </div>
        <div
          v-if="hover"
          class="field-tooltip"
          :style="{ left: `${hover.x}px`, top: `${hover.y}px` }"
        >
          <span>风险 {{ hover.risk.toFixed(3) }}</span
          ><span>{{ hover.range.toFixed(1) }} m</span>
        </div>
      </div>
      <aside class="field-summary">
        <div class="eyebrow">SELECTED CONTRIBUTION</div>
        <div class="field-selected">
          <span>{{ store.selectedId }}</span
          ><i class="dot green"></i>
        </div>
        <div class="field-risk">
          <b>{{ selectedRisk.toFixed(2) }}</b
          ><span>/ 1.00</span>
        </div>
        <div class="risk-meter"><i :style="{ width: `${selectedRisk * 100}%` }"></i><em></em></div>
        <p class="risk-description">
          {{
            selectedRisk >= 0.75
              ? '高风险关注目标'
              : selectedRisk >= 0.4
                ? '持续观测目标'
                : '低风险观测目标'
          }}<span>{{
            store.selected?.fusion ? '基于位置与运动状态估计' : '等待有效融合数据'
          }}</span>
        </p>
        <div class="side-divider"></div>
        <div class="field-motion">
          <span>目标合速度</span
          ><b>{{ store.selected?.fusion?.speed?.toFixed(2) ?? '—' }}<small> m/s</small></b>
        </div>
        <div class="field-motion">
          <span>目标航向 / N</span
          ><b>{{ store.selected?.fusion?.heading?.toFixed(1) ?? '—' }}<small> °</small></b>
        </div>
        <div class="contribution-key"><i></i>虚线为选中目标风险贡献边界</div>
      </aside>
    </div>
  </section>
</template>
