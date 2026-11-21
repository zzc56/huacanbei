<script setup lang="ts">
import { computed } from 'vue';
import type { VehicleResult } from '../../../../sentinel-backend/src/vehicle/contracts';
import UiIcon from './UiIcon.vue';

const props = defineProps<{ kind: 'camera' | 'lidar'; result: VehicleResult | null }>();
const isCamera = computed(() => props.kind === 'camera');
const sample = computed(() => props.result?.observations?.[props.kind]);
const cameraPoints = computed(() => props.result?.observations?.camera?.observations ?? []);
const scan = computed(() => props.result?.observations?.lidar?.observations ?? []);
const count = computed(() => sample.value?.observations.length);
const title = computed(() => isCamera.value ? '固定摄像头' : '车载雷达');

// Equal distances on both ground axes occupy equal screen space.
const ground = computed(() => {
  const xs = [0, ...cameraPoints.value.map(p => p.xM)], ys = [0, ...cameraPoints.value.map(p => p.yM)];
  let step = 0.25;
  while (Math.ceil(Math.max(...xs) / step) - Math.floor(Math.min(...xs) / step) > 8 ||
         Math.ceil(Math.max(...ys) / step) - Math.floor(Math.min(...ys) / step) > 4) step *= 2;
  const xMin = Math.floor(Math.min(...xs) / step) * step;
  const yMin = Math.floor(Math.min(...ys) / step) * step;
  return { step, xMin, yMin,
    x: (metres: number) => 38 + 24 * (metres - xMin) / step,
    y: (metres: number) => 106 - 24 * (metres - yMin) / step };
});
const radarRange = computed(() => 2 ** Math.ceil(Math.log2(Math.max(1, ...scan.value.map(p => p.rangeM)))));
const radarDots = computed(() => scan.value.map(p => {
  const r = 45 * p.rangeM / radarRange.value, angle = p.bearingDeg * Math.PI / 180;
  return { x: 133 + r * Math.sin(angle), y: 65 - r * Math.cos(angle) };
}));
</script>

<template>
  <section class="glass-panel sensor-panel" :class="kind" :aria-label="title + '观测'">
    <header>
      <div class="section-heading"><h2>{{ title }}</h2></div>
      <span class="count">{{ count == null ? '等待观测' : count + ' 个目标' }}</span>
    </header>
    <div class="plot-caption"><span><UiIcon :name="isCamera ? 'camera' : 'radar'" :size="15" />
      {{ isCamera ? '场地坐标 · 俯视' : '车身方位 · 俯视' }}</span>
      <span v-if="sample && !sample.includedInFusion" class="unused">未参与融合</span>
    </div>
    <svg v-if="isCamera" viewBox="0 0 268 129" class="sensor-plot" role="img" aria-label="固定摄像头检测目标的地面位置">
      <g class="grid">
        <path v-for="i in 9" :key="'x'+i" :d="'M' + (38 + (i-1)*24) + ' 10v96'" />
        <path v-for="i in 5" :key="'y'+i" :d="'M38 ' + (10 + (i-1)*24) + 'h192'" />
      </g>
      <path class="axis" :d="'M38 ' + ground.y(0) + 'h192 M' + ground.x(0) + ' 10v96'" />
      <g class="axis-text">
        <text v-for="i in [0,4,8]" :key="i" :x="38+i*24" y="121" text-anchor="middle">{{ ground.xMin + i*ground.step }}</text>
        <text v-for="i in [0,2,4]" :key="i" x="32" :y="109-i*24" text-anchor="end">{{ ground.yMin + i*ground.step }}</text>
        <text x="242" y="109">X</text><text x="12" y="14">Y</text>
      </g>
      <g v-for="(p, i) in cameraPoints" :key="i" :transform="'translate(' + ground.x(p.xM) + ',' + ground.y(p.yM) + ')'">
        <path class="mark" d="M-8 -3v-5h5m6 0h5v5m0 6v5H3m-6 0h-5V3" /><circle r="3.1" class="dot" />
      </g>
    </svg>
    <svg v-else viewBox="0 0 268 129" class="sensor-plot" role="img" aria-label="车载雷达目标的距离与方位，车头朝上">
      <g class="grid"><circle v-for="i in 4" :key="i" cx="133" cy="65" :r="45*i/4" /></g>
      <path class="axis" d="M80 65h106M133 16v98" />
      <path class="car" d="m133 59 4 10-4-2-4 2z" />
      <g class="axis-text"><text x="133" y="13" text-anchor="middle">车头 · 0°</text><text x="191" y="69">右</text>
        <text x="133" y="124" text-anchor="middle">外圈 {{ radarRange }} m</text></g>
      <g v-for="(p, i) in radarDots" :key="i" :transform="'translate(' + p.x + ',' + p.y + ')'">
        <circle r="6.5" class="mark" /><circle r="2.7" class="dot" />
      </g>
    </svg>
    <div v-if="count" class="sensor-targets" tabindex="0" :aria-label="title + '目标清单'">
      <template v-if="isCamera">
        <div v-for="(p, i) in cameraPoints" :key="i"><b>C{{ i+1 }}</b><span>X {{ p.xM.toFixed(2) }} m</span><span>Y {{ p.yM.toFixed(2) }} m</span></div>
      </template>
      <template v-else>
        <div v-for="(p, i) in scan" :key="i"><b>L{{ i+1 }}</b><span>距离 {{ p.rangeM.toFixed(2) }} m</span><span>方位 {{ p.bearingDeg.toFixed(1) }}°</span></div>
      </template>
    </div>
    <p v-else>{{ sample ? '本帧未发现目标' : '等待有效观测' }}</p>
  </section>
</template>

<style scoped>
.sensor-panel { --ink: #16749a; --wash: #e1f1f9; min-width: 0; padding: clamp(12px, 1.35vw, 20px); display: flex; flex-direction: column; }
.sensor-panel.lidar { --ink: #177b73; --wash: #ddf2ed; }
header, .plot-caption, .plot-caption > span, .sensor-targets > div { display: flex; align-items: center; }
header, .plot-caption { justify-content: space-between; gap: 6px; }
.section-heading h2 { font-size: clamp(17px, 1.5vw, 22px); line-height: 1.35; }
.count { background: var(--wash); color: var(--ink); border-radius: 4px; padding: 2px 7px; white-space: nowrap; font-size: 12px; font-weight: 650; }
.plot-caption { color: #496b80; font-size: 11px; margin: 8px 0 5px; }
.plot-caption > span { gap: 5px; }
.plot-caption .unused { color: #875a19; }
.sensor-plot { display: block; flex: 1 1 auto; width: 100%; min-height: 88px; height: 12.8vh; max-height: 164px; background: linear-gradient(125deg,#f7fcfd,#eaf4f8); border: 1px solid #b4d2dd; border-radius: 6px; }
.grid, .axis, .mark { stroke-width: 1; stroke: #bad3dc; fill: none; }
.axis { stroke: #89afbc; }
.axis-text { font: 10px 'Segoe UI', 'Microsoft YaHei', sans-serif; fill: #44697a; }
.mark { fill: #ffffffa8; stroke: var(--ink); stroke-width: 1.8; }
.dot { fill: var(--ink); }
.car { fill: #264d63; }
.sensor-targets, p { margin: 6px 0 0; line-height: 1.6; color: #42657b; font-size: 12px; }
.sensor-targets { height: 24px; max-height: 48px; overflow: auto; font-variant-numeric: tabular-nums; }
.sensor-targets:has(> div:nth-child(2)) { height: 48px; }
.sensor-targets > div { gap: 9px; min-height: 23px; flex-wrap: wrap; }
.sensor-targets b { color: var(--ink); }
</style>
