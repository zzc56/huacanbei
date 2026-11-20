<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, shallowRef } from 'vue';
import { useRoute } from 'vue-router';
import type { VehicleResult, VehicleDemoResult } from '../../../sentinel-backend/src/vehicle/contracts';
import VehicleRiskMap from './components/VehicleRiskMap.vue';

const route = useRoute();
const endpoint = new URL(import.meta.env.VITE_STREAM_URL || 'http://127.0.0.1:3001', window.location.href);
if (endpoint.protocol === 'ws:') endpoint.protocol = 'http:';
if (endpoint.protocol === 'wss:') endpoint.protocol = 'https:';
const base = endpoint.origin + '/api/vehicle/';
const sources = { camera: '固定摄像头', lidar: '车载雷达', both: '摄像头 + 雷达' };
const actions = { cruise: '巡航', slow: '减速', stop: '停车' };
const reasons = {
  near_obstacle: '前方障碍进入停车距离', forward_risk: '前方通道风险触发限速',
  camera_unavailable: '视觉观测缺失或时间未对齐', path_clear: '前方通道畅通',
  pose_or_lidar_unavailable: '位姿或雷达缺失、过期或时间未对齐',
};
const stageLabels = ['前方畅通', '摄像头先发现', '两路看到同一人', '近距离停车'];
const mode = ref<'demo' | 'input'>('demo'), playing = ref(false), error = ref('');
const frame = shallowRef<VehicleResult | null>(null), demo = shallowRef<VehicleDemoResult | null>(null);
const stageIndex = computed(() => {
  const sample = demo.value;
  return sample ? sample.stages.filter(step => step <= sample.step).length - 1 : -1;
});
let timer: ReturnType<typeof setTimeout> | undefined, active: AbortController | undefined;

function cancel() {
  clearTimeout(timer);
  active?.abort();
}
async function load(step = 0) {
  cancel();
  const controller = new AbortController();
  active = controller;
  try {
    const path = mode.value === 'demo' ? 'demo/' + step : 'frame';
    const response = await fetch(base + path, { cache: 'no-store',
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(1500)]) });
    if (!response.ok) throw Error();
    const data = await response.json();
    if (controller.signal.aborted) return;
    if (!data?.motion || !Array.isArray(data.obstacles)) throw Error();
    frame.value = data;
    error.value = '';
    if (mode.value === 'input') {
      timer = setTimeout(() => void load(), 100);
    } else {
      const sample: VehicleDemoResult = data;
      demo.value = sample;
      if (sample.step >= sample.lastStep) playing.value = false;
      if (playing.value) timer = setTimeout(() => void load(sample.step + 1), sample.tickMs);
    }
  } catch {
    if (controller.signal.aborted) return;
    frame.value = null;
    error.value = '未收到后端结果，请检查 SENTINEL 服务连接。';
    playing.value = false;
    if (mode.value === 'input') timer = setTimeout(() => void load(), 500);
  }
}
function setMode(next: 'demo' | 'input') {
  mode.value = next; playing.value = false; demo.value = null; frame.value = null; error.value = '';
  void load();
}
function seek(step: number) { playing.value = false; void load(step); }
function toggle() {
  if (playing.value) { cancel(); playing.value = false; return; }
  const step = demo.value && demo.value.step < demo.value.lastStep ? demo.value.step : 0;
  playing.value = true;
  void load(step);
}
onMounted(() => void load());
onUnmounted(cancel);
</script>

<template>
  <main class="vehicle-shell">
    <header>
      <div class="vehicle-title"><img src="/sentinel.svg" alt="" /><div><small>SENTINEL</small><h1>车路协同风险场</h1></div></div>
      <nav aria-label="观测来源">
        <router-link v-if="route.query.from === 'cockpit'" to="/">返回驾驶舱</router-link>
        <button :aria-pressed="mode === 'demo'" @click="setMode('demo')">离线演示</button>
        <button :aria-pressed="mode === 'input'" @click="setMode('input')">接口观测</button>
      </nav>
    </header>
    <p v-if="error" class="connection" role="alert">{{ error }} <button @click="load(demo?.step ?? 0)">重试</button></p>
    <div class="vehicle-grid">
      <section class="card">
        <div class="card-title"><h2>前方风险场</h2><span>{{ mode === 'demo' ? '模拟观测 · 静止行人' : '已提交的观测帧' }}</span></div>
        <VehicleRiskMap :result="frame" />
        <p class="legend">虚线为前方通道<span>场值低 <i /> 高</span></p>
      </section>
      <section class="card decision" aria-label="车辆决策">
        <h2>车辆决策</h2>
        <div class="command" :data-action="frame?.motion.action">
          <strong>{{ frame ? actions[frame.motion.action] : '等待数据' }}</strong>
          <p>{{ frame ? reasons[frame.motion.reason] : '等待风险计算结果' }}</p>
        </div>
        <dl>
          <div><dt>速度上限</dt><dd>{{ frame?.motion.speedLimitMps.toFixed(2) ?? '—' }} <small>m/s</small></dd></div>
          <div><dt>通道内最近距离</dt><dd>{{ frame?.closestForwardM?.toFixed(2) ?? '—' }} <small>m</small></dd></div>
          <div><dt>通道风险峰值</dt><dd>{{ frame?.corridorRisk?.toFixed(3) ?? '—' }}</dd></div>
        </dl>
      </section>
      <section class="card counts">
        <h2>障碍观测</h2>
        <dl><div><dt>固定摄像头</dt><dd>{{ frame?.cameraCount ?? '—' }}</dd></div>
          <div><dt>车载雷达</dt><dd>{{ frame?.lidarCount ?? '—' }}</dd></div>
          <div><dt>融合后目标</dt><dd>{{ frame?.field ? frame.obstacles.length : '—' }}</dd></div></dl>
        <ul v-if="frame?.obstacles.length" aria-label="融合目标">
          <li v-for="(o, i) in frame.obstacles" :key="i">{{ sources[o.source] }} · 横向 {{ o.xM.toFixed(2) }} m，纵向 {{ o.yM.toFixed(2) }} m</li>
        </ul>
      </section>
      <section v-if="mode === 'demo'" class="card playback">
        <div class="card-title"><h2>演示回放</h2><button class="play" @click="toggle">{{ playing ? '暂停' : demo && demo.step === demo.lastStep ? '重新播放' : '播放演示' }}</button></div>
        <div class="stages" aria-label="演示阶段">
          <button v-for="(step, i) in demo?.stages" :key="step" :aria-pressed="stageIndex === i" @click="seek(step)">{{ stageLabels[i] }}</button>
        </div>
      </section>
    </div>
  </main>
</template>

<style scoped>
.vehicle-shell {min-height:100vh; padding:clamp(16px,3vw,44px) max(4vw,calc((100vw - 1320px)/2)); color:#193b43; background:#edf4f2; font-family:'Microsoft YaHei','Segoe UI',sans-serif}
header,.vehicle-title,nav,.card-title,.legend,.legend span {display:flex; align-items:center; gap:12px}
header,.card-title,.legend {justify-content:space-between}
header {margin-bottom:24px; flex-wrap:wrap}
.vehicle-title img {width:44px;height:44px}
.vehicle-title small {letter-spacing:.18em;color:#21736d;font-weight:700}
h1 {font-size:clamp(24px,2.6vw,36px);line-height:1.25}
h2 {font-size:18px}
button {color:#235651;background:#f5f9f7;border:1px solid #b7d1c9;border-radius:6px;padding:7px 12px;cursor:pointer}
button[aria-pressed=true],button.play {background:#17625e;color:white;border-color:#17625e}
nav a {font-size:13px;color:#286a64}
.vehicle-grid {display:grid;grid-template-columns:minmax(0,1.55fr) minmax(270px,1fr);gap:16px}
.card {background:#fff;border:1px solid #cddfd8;border-radius:14px;padding:clamp(15px,2vw,26px)}
.card-title {margin-bottom:12px}
.card-title span,.legend,dt,.command p {font-size:14px;color:#44645e}
.legend {margin:10px 0 0}.legend i {width:64px;height:7px;border-radius:4px;background:linear-gradient(90deg,#edf4ef,#a6d866,#e6af32,#d84c28)}
.command {padding:16px 0;border-bottom:1px solid #dce7e1}
.command strong {font-size:clamp(34px,4vw,58px);color:#21675c}
.command[data-action=slow] strong {color:#97630e}
.command[data-action=stop] strong {color:#ad4634}
dl {margin-top:12px}.decision dl div {display:flex;justify-content:space-between;align-items:baseline;padding:9px 0}
dd {font-size:22px;font-weight:650;font-variant-numeric:tabular-nums} dd small {font-size:13px}
.counts dl {display:flex;gap:clamp(20px,4vw,56px)}
.counts ul {padding-left:19px;margin-top:8px;color:#435e64;font-size:14px}
.stages {display:flex;flex-wrap:wrap;gap:8px}
.connection {margin:0 0 12px;color:#923f2e}
@media(max-width:740px){.vehicle-grid {grid-template-columns:1fr}.vehicle-shell {padding:16px} .decision dl {display:flex;gap:14px;flex-wrap:wrap}.decision dl div {display:block}.command {padding:5px 0 10px}}
</style>
