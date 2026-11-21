<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import type { VehicleResult, VehicleDemoResult } from '../../../sentinel-backend/src/vehicle/contracts';
import StatusBar from './components/StatusBar.vue';
import UiIcon from './components/UiIcon.vue';
import { vehicleFieldLegend } from './core/fieldColors';
import './styles.css';
import VehicleRiskMap from './components/VehicleRiskMap.vue';
import VehicleSensorPanel from './components/VehicleSensorPanel.vue';
import Dashboard from './Dashboard.vue';
import SceneViewport from './components/SceneViewport.vue';
import { vehicleScene } from './core/vehicleScene';
import { useSceneStore } from './stores/scene';
import { RealDataAdapter } from '../core/RealDataAdapter';
import type { ViewMode } from './renderers/lightScene';

const route = useRoute();
const router = useRouter();
const tabs = [{id:'overview',name:'总览',icon:'layers'}, {id:'camera',name:'摄像头感知',icon:'camera'},
  {id:'radar',name:'雷达探测',icon:'radar'}, {id:'risk',name:'风险场',icon:'risk'}] as const;
const view = computed(()=>tabs.find(t=>t.id===route.query.view)?.id ?? 'overview');
function openView(next: ViewMode | 'overview') {
  void router.push({name:'vehicle',query:{...route.query,view:next==='overview'?undefined:next}});
}
const endpoint = new URL(import.meta.env.VITE_STREAM_URL || 'http://127.0.0.1:3001', window.location.href);
if (endpoint.protocol === 'ws:') endpoint.protocol = 'http:';
if (endpoint.protocol === 'wss:') endpoint.protocol = 'https:';
const base = endpoint.origin + '/api/vehicle/';
const originalMonitor=ref('');
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
const store=useSceneStore();
const previous={frame:store.frame,selectedId:store.selectedId,playing:store.playing,connection:store.connection,videoSource:store.videoSource};
store.videoSource={type:'mock'};
watch(()=>store.videoSource.url,(_,old)=>{if(old?.startsWith('blob:'))URL.revokeObjectURL(old);});
let adapter=new RealDataAdapter(endpoint.origin);
const frozen=ref(false), refreshHz=ref(0), requestMs=ref<number|null>(null);
let receipts:number[]=[];
watch([frame,mode],()=>{
  store.frame=adapter.trails(vehicleScene(frame.value,mode.value==='demo',endpoint.origin));
  store.connection=frame.value ? 'connected' : error.value ? 'error' : 'connecting';
  if(!store.frame.targets.some(t=>t.id===store.selectedId))store.select(store.frame.targets[0]?.id ?? '—');
},{immediate:true,flush:'sync'});
watch([playing,mode,frozen],()=>{store.playing=mode.value==='demo'?playing.value:!frozen.value;},{immediate:true,flush:'sync'});
const stageIndex = computed(() => {
  const sample = demo.value;
  return sample ? sample.stages.filter(step => step <= sample.step).length - 1 : -1;
});
const showCorridor = ref(true), showContours = ref(true);
const observationStatus = computed(() => {
  if (error.value) return '连接中断';
  if (!frame.value) return '连接中';
  if (mode.value === 'demo') return playing.value ? '正在回放' : '离线回放';
  if(frozen.value)return '显示已冻结';
  return frame.value.field ? '收到有效观测' : frame.value.capture?.vision ? '摄像头在线' : '等待有效观测';
});
function playbackSeconds(step: number) {
  return ((demo.value?.tickMs ?? 0) * step / 1000).toFixed(1);
}
let timer: ReturnType<typeof setTimeout> | undefined, active: AbortController | undefined;

function cancel() {
  clearTimeout(timer);
  active?.abort();
}
async function load(step = 0) {
  cancel();
  const controller = new AbortController();
  active = controller;
  const started=performance.now();
  try {
    const path = mode.value === 'demo' ? 'demo/' + step : 'frame';
    const response = await fetch(base + path, { cache: 'no-store',
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(1500)]) });
    if (!response.ok) throw Error();
    const data = await response.json();
    if (controller.signal.aborted) return;
    if (!data?.motion || !data.observations || !Array.isArray(data.obstacles)) throw Error();
    const received=performance.now();
    requestMs.value=Math.round(received-started);
    receipts=receipts.filter(t=>received-t<1000);
    receipts.push(received);refreshHz.value=receipts.length;
    frame.value = data;
    error.value = '';
    if (mode.value === 'input' && !frozen.value) {
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
    requestMs.value=null;refreshHz.value=0;receipts=[];
    error.value = '未收到后端结果，请检查 SENTINEL 服务连接。';
    playing.value = false;
    if (mode.value === 'input') timer = setTimeout(() => void load(), 500);
  }
}
function setMode(next: 'demo' | 'input') {
  if(mode.value===next)return;
  cancel(); adapter=new RealDataAdapter(endpoint.origin); frozen.value=false; store.videoSource={type:'mock'};
  mode.value = next; playing.value = false; demo.value = null; frame.value = null; error.value = '';
  void load();
}
function seek(step: number) { playing.value = false; void load(step); }
function toggle() {
  if(mode.value==='input') {
    frozen.value=!frozen.value;
    if(frozen.value)cancel();else void load();
    return;
  }
  if (playing.value) { cancel(); playing.value = false; return; }
  const step = demo.value && demo.value.step < demo.value.lastStep ? demo.value.step : 0;
  playing.value = true;
  void load(step);
}
onMounted(() => {
  void load();
  void fetch(new URL('/api/health',endpoint),{signal:AbortSignal.timeout(1500)}).then(r=>r.json()).then(h=>{
    originalMonitor.value=h.recordingAvailable||h.source==='recording'?'历史实测回放':h.source==='live'?'原实时驾驶舱':'';
  }).catch(()=>{});
});
onUnmounted(()=>{cancel();
  if(store.videoSource.url?.startsWith('blob:'))URL.revokeObjectURL(store.videoSource.url);
  Object.assign(store,previous);});
</script>

<template>
  <main class="vehicle-platform">
    <div class="cockpit-stage vehicle-stage">
      <StatusBar class="vehicle-header" vehicle :status-text="observationStatus" :refresh-hz="store.playing ? refreshHz : 0" :request-ms="requestMs" @toggle="toggle" />
      <div class="glass-panel vehicle-navigation">
        <nav class="view-tabs" aria-label="感知视图">
          <button v-for="tab in tabs" :key="tab.id" :class="{active:view===tab.id}" :aria-pressed="view===tab.id" @click="openView(tab.id)">
            <UiIcon :name="tab.icon" :size="18" />{{ tab.name }}
          </button>
        </nav>
        <div class="view-actions">
          <span v-if="view!=='overview' && frame" class="detail-action">{{ actions[frame.motion.action] }} · {{ frame.motion.speedLimitMps.toFixed(2) }} m/s</span>
          <button :aria-pressed="mode==='demo'" @click="setMode('demo')">离线演示</button>
          <button :aria-pressed="mode==='input'" @click="setMode('input')">实车观测</button>
          <router-link v-if="originalMonitor||route.query.from==='cockpit'" class="back-link" to="/">{{ originalMonitor||'原驾驶舱' }}</router-link>
        </div>
      </div>
      <p v-if="error" class="connection" role="alert">{{ error }} <button @click="load(demo?.step ?? 0)">重试</button></p>

      <div class="vehicle-layout" :class="{'detail-layout':view!=='overview'}">
        <Dashboard v-if="view!=='overview'" :vehicle-view="view" />
        <template v-else>
        <div class="vehicle-sensors">
          <VehicleSensorPanel kind="camera" :result="frame">
            <template #camera>
              <div class="vehicle-camera">
                <SceneViewport mode="camera" :targets="store.frame.targets" :time="store.frame.timestamp/1000" compact />
                <span v-if="store.videoSource.type!=='mock'" class="preview-source">独立预览 · 未参与融合</span>
                <button class="expand-camera" aria-label="展开摄像头感知" @click="openView('camera')"><UiIcon name="focus" :size="16"/></button>
              </div>
            </template>
          </VehicleSensorPanel>
          <VehicleSensorPanel kind="lidar" :result="frame" />
        </div>
        <section class="glass-panel field-panel" aria-label="融合风险场">
          <div class="panel-top">
            <div class="section-heading"><h2>融合风险场</h2></div>
            <span class="status" :class="{ muted: !frame?.field }"><i class="live-dot" />{{ observationStatus }}</span>
          </div>
          <div class="map-toolbar">
            <span>{{ mode === 'demo' ? '模拟观测 · 低速直行 · 静止行人' : '接口观测 · 车身坐标系' }}</span>
            <div class="map-options" aria-label="图层">
              <button :aria-pressed="showCorridor" @click="showCorridor = !showCorridor">通道</button>
              <button :aria-pressed="showContours" @click="showContours = !showContours">等值线</button>
            </div>
          </div>
          <VehicleRiskMap :result="frame" :corridor="showCorridor" :contours="showContours" />
          <footer class="plot-legend">
            <span class="corridor-key"><i />前方通道</span>
            <span class="color-key">相对风险 <small>0</small><i :style="{ background: vehicleFieldLegend }" /><small>1</small></span>
          </footer>
        </section>

        <aside class="vehicle-rail">
          <section class="glass-panel decision-panel" aria-label="小车应执行的动作">
            <div class="panel-top"><div class="section-heading"><h2>小车应执行的动作</h2></div><UiIcon name="car" /></div>
            <div class="decision-band" :data-action="frame?.motion.action">
              <span class="action-symbol"><UiIcon :name="frame?.motion.action === 'stop' ? 'risk' : frame?.motion.action === 'slow' ? 'pulse' : 'car'" :size="26" /></span>
              <div><strong>{{ frame ? actions[frame.motion.action] : '等待数据' }}</strong>
                <p>{{ frame ? reasons[frame.motion.reason] : '等待风险计算结果' }}</p></div>
            </div>
            <dl class="metrics">
              <div><dt>速度上限</dt><dd>{{ frame?.motion.speedLimitMps.toFixed(2) ?? '—' }} <small>m/s</small></dd></div>
              <div><dt>通道内最近距离</dt><dd>{{ frame?.closestForwardM?.toFixed(2) ?? '—' }} <small>m</small></dd></div>
            </dl>
            <div class="risk-reading"><span>通道风险峰值</span><strong>{{ frame?.corridorRisk?.toFixed(3) ?? '—' }}</strong></div>
            <div class="risk-scale" :style="{ background: vehicleFieldLegend }" aria-hidden="true"><b v-if="frame?.corridorRisk != null" :style="{ left: frame.corridorRisk * 100 + '%' }" /></div>
          </section>

          <section class="glass-panel observations" aria-label="融合目标">
            <div class="panel-top"><div class="section-heading"><h2>融合目标</h2></div>
              <span class="total">{{ frame?.field ? frame.obstacles.length + ' 个目标' : '等待融合' }}</span>
            </div>
            <div v-if="frame?.obstacles.length" class="target-scroll" tabindex="0" aria-label="融合目标坐标">
              <table><thead><tr><th>观测来源</th><th>横向 X</th><th>前向 Y</th></tr></thead>
                <tbody><tr v-for="(o, i) in frame.obstacles" :key="i"><td>{{ sources[o.source] }}</td><td>{{ o.xM.toFixed(2) }} m</td><td>{{ o.yM.toFixed(2) }} m</td></tr></tbody>
              </table>
            </div>
            <p v-else class="no-targets">{{ frame?.field ? '当前帧未发现障碍' : '等待有效观测' }}</p>
          </section>
        </aside>
        </template>

        <section v-if="mode === 'demo'" class="glass-panel replay-panel" aria-label="演示回放">
          <div class="replay-command">
            <div class="section-heading"><h2>演示回放</h2></div>
            <button class="transport" @click="toggle"><i :class="playing ? 'pause' : 'play'" aria-hidden="true" />{{ playing ? '暂停' : demo && demo.step === demo.lastStep ? '重新播放' : '播放演示' }}</button>
          </div>
          <div class="replay-track">
            <div class="stage-list" aria-label="演示阶段">
              <button v-for="(step, i) in demo?.stages" :key="step" :aria-pressed="stageIndex === i" @click="seek(step)">
                <i aria-hidden="true" />{{ stageLabels[i] }}
              </button>
            </div>
            <div v-if="demo" class="scrubber">
              <input type="range" min="0" :max="demo.lastStep" step="1" :value="demo.step" aria-label="演示进度"
                :aria-valuetext="playbackSeconds(demo.step) + ' 秒'" @input="seek(Number(($event.target as HTMLInputElement).value))" />
              <output>{{ playbackSeconds(demo.step) }} / {{ playbackSeconds(demo.lastStep) }} s</output>
            </div>
          </div>
        </section>
      </div>
    </div>
  </main>
</template>

<style scoped src="./vehicle.css"></style>
