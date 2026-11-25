<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import type { StationaryPose, VehicleResult } from '../../../sentinel-backend/src/vehicle/contracts';
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
import { useVehicleDrive } from './composables/useVehicleDrive';
import DriveStatus from './components/DriveStatus.vue';
import GroundCalibrationDialog from './components/GroundCalibrationDialog.vue';
import CameraDetectionPicker from './components/CameraDetectionPicker.vue';

const route = useRoute();
const router = useRouter();
const tabs = [{id:'overview',name:'总览',icon:'layers'}, {id:'camera',name:'摄像头感知',icon:'camera'},
  {id:'radar',name:'雷达探测',icon:'radar'}, {id:'risk',name:'风险场',icon:'risk'}, {id:'drive',name:'小车控制',icon:'car'}] as const;
const view = computed(()=>tabs.find(t=>t.id===route.query.view)?.id ?? 'overview');
function openView(next: ViewMode | 'overview' | 'drive') {
  void router.push({name:'vehicle',query:{...route.query,view:next==='overview'?undefined:next}});
}
const endpoint = new URL(import.meta.env.VITE_STREAM_URL || 'http://127.0.0.1:3001', window.location.href);
if (endpoint.protocol === 'ws:') endpoint.protocol = 'http:';
if (endpoint.protocol === 'wss:') endpoint.protocol = 'https:';
const base = endpoint.origin + '/api/vehicle/';
const driving = computed(() => view.value === 'drive');
const calibrating = ref(false);
const stationaryPose = shallowRef<StationaryPose | null>(null);
const poseInput = ref<{xM:number|''; yM:number|''; headingDeg:number|''}>({xM:'',yM:'',headingDeg:''});
const keyboardBlocked = computed(() => calibrating.value || stationaryPose.value !== null);
const drive = useVehicleDrive(driving, endpoint, keyboardBlocked);
function openCalibration() {
  if (drive.expanded.value) drive.enlarge();
  else drive.stop();
  calibrating.value = true;
}
watch([view, () => route.query.detection], () => {
  calibrating.value = false;
  stationaryPose.value = null;
});
const detectionModes = [{id:'radar', name:'只有雷达检测'}, {id:'fusion', name:'摄像头和雷达融合检测'}] as const;
const detectionMode = computed(() => route.query.detection === 'fusion' ? 'fusion' : 'radar');
const radarOnly = computed(() => driving.value && detectionMode.value === 'radar');
function openDetection(mode: typeof detectionModes[number]['id']) {
  if (detectionMode.value !== mode) void router.push({name:'vehicle', query:{...route.query, detection:mode}});
}
const bench = computed(() => driving.value ? drive.snapshot.value?.bench : undefined);
const radarTrial = computed(() => bench.value?.radarTrial);
const cameraInFusion = computed(() => {
  const sample = frame.value?.observations.camera;
  const image = frame.value?.capture?.vision;
  return !!sample?.includedInFusion && !!image && (frame.value?.stationaryFusion === 'aligned' ||
    (sample.sequence === image.sequence && sample.capturedAtMs === Date.parse(image.captured_utc)));
});
const hardwareLidar = computed(() => driving.value ? drive.snapshot.value?.telemetry?.lidar : undefined);
const stationaryId = computed(() => drive.snapshot.value?.telemetry?.stationaryId);
function confirmStationaryPose() {
  const {xM,yM,headingDeg} = poseInput.value;
  const id = stationaryId.value;
  if (!id || xM === '' || yM === '' || headingDeg === '') return;
  drive.stop();
  stationaryPose.value = {xM,yM,headingDeg,stationaryId:id};
}
function finishStationaryFusion() {
  drive.stop();
  stationaryPose.value = null;
}
const originalMonitor = ref('');
const sources = { camera: '固定摄像头', lidar: '车载雷达', both: '摄像头 + 雷达' };
const actions = { cruise: '巡航', slow: '减速', stop: '停车' };
const reasons = {
  near_obstacle: '前方障碍进入停车距离', forward_risk: '前方通道风险触发限速',
  blind_corner: '固定摄像头发现弯后障碍',
  camera_unavailable: '视觉观测缺失或时间未对齐', path_clear: '前方通道畅通',
  pose_or_lidar_unavailable: '位姿或雷达缺失、过期或时间未对齐',
};
const keyGroups = [
  {label:'按住前进', keys:[['KeyW','W'],['ArrowUp','↑']]},
  {label:'立即停车', keys:[['Space','空格']]},
] as const;
const observedFrame = shallowRef<VehicleResult | null>(null);
const frame = computed(() => {
  if (radarOnly.value) return drive.snapshot.value?.radarRisk ?? null;
  const current = observedFrame.value;
  if (!driving.value || !current?.field ||
      (current.observations.camera?.includedInFusion && current.observations.lidar?.includedInFusion)) return current;
  return { ...current, field:null, obstacles:[], corridorRisk:null, closestForwardM:null, cameraCount:null, lidarCount:null };
});
const riskTitle = computed(() => radarOnly.value ? '车载雷达风险场' : '融合风险场');
const targetsTitle = computed(() => radarOnly.value ? '雷达目标' : '融合目标');
const lastRiskFrame = shallowRef<VehicleResult | null>(null);
const lastCameraCapture = shallowRef<VehicleResult['capture']>();
const ballNumbers = new Map<string, number>();
const displayedRisk = computed(() => frame.value?.field ? frame.value : lastRiskFrame.value);
const riskHeld = computed(() => !!displayedRisk.value && !frame.value?.field);
const cameraHeld = computed(() => !radarOnly.value && !frame.value?.capture?.vision && !!lastCameraCapture.value?.vision);
watch(frame, current => {
  if (current?.field) lastRiskFrame.value = current;
  if (current?.capture?.vision) lastCameraCapture.value = current.capture;
}, {flush:'sync'});
watch([view, radarOnly, stationaryPose], () => { lastRiskFrame.value = null; }, {flush:'sync'});
const waitingForStationaryFusion = {
  waiting_for_pose:'小车移动或轮速反馈中断，请重新确认位置和朝向',
  waiting_for_radar:'等待新鲜的车载雷达扫描',
  waiting_for_camera:'等待有效的监控观测与地面标定',
  waiting_for_sync:'等待采集时间接近的监控帧和雷达扫描',
  aligned:'',
};
const fusionEmptyText = computed(() => {
  if (radarOnly.value) return '等待车载雷达有效扫描';
  if (!driving.value) return undefined;
  const state = frame.value?.stationaryFusion;
  if (stationaryPose.value) return state ? waitingForStationaryFusion[state] : '正在读取实时融合数据';
  return '在上方确认静止位姿，或接入实时小车定位';
});
const store = useSceneStore();
const previous = {frame:store.frame, selectedId:store.selectedId, playing:store.playing, connection:store.connection, videoSource:store.videoSource};
store.videoSource = {type:'mock'};
watch(() => store.videoSource.url, (_, old) => { if (old?.startsWith('blob:')) URL.revokeObjectURL(old); });

const radarAdapter = new RealDataAdapter(endpoint.origin);
const fusionAdapter = new RealDataAdapter(endpoint.origin);
const error = ref('');
const frozen = ref(false), refreshHz = ref(0), requestMs = ref<number | null>(null);
let receipts: number[] = [];
watch([frame, error], () => {
  const adapter = radarOnly.value ? radarAdapter : fusionAdapter;
  store.frame = adapter.trails(vehicleScene(
    frame.value, endpoint.origin, radarOnly.value ? undefined : lastCameraCapture.value, ballNumbers,
  ));
  store.connection = frame.value ? 'connected' : error.value ? 'error' : 'connecting';
  if (!store.frame.targets.some(t => t.id === store.selectedId)) store.select(store.frame.targets[0]?.id ?? '—');
}, {immediate:true, flush:'sync'});
watch(frozen, paused => { store.playing = !paused; }, {immediate:true, flush:'sync'});

const showCorridor = ref(true), showContours = ref(true);
const observationStatus = computed(() => {
  if (radarOnly.value) {
    if (frame.value?.field) return '车载雷达在线';
    return hardwareLidar.value?.status === 'stale' ? '雷达反馈超时' : '等待车载雷达';
  }
  if (error.value) return '连接中断';
  if (!frame.value) return '连接中';
  if (frozen.value) return '显示已冻结';
  if (driving.value) return frame.value.field ? '两路观测已对齐' : '等待融合观测';
  return frame.value.field ? '收到有效观测' : frame.value.capture?.vision ? '摄像头在线' : '等待有效观测';
});
let timer: ReturnType<typeof setTimeout> | undefined, active: AbortController | undefined;
function cancel() {
  clearTimeout(timer);
  active?.abort();
}
async function load() {
  if (radarOnly.value) return;
  cancel();
  const controller = new AbortController();
  active = controller;
  const started = performance.now();
  try {
    const pose = stationaryPose.value;
    const url = new URL(pose ? 'stationary-fusion' : 'frame', base);
    if (pose) url.search = new URLSearchParams({
      xM:String(pose.xM), yM:String(pose.yM), headingDeg:String(pose.headingDeg), stationaryId:pose.stationaryId,
    }).toString();
    const response = await fetch(url, {cache:'no-store',
      signal:AbortSignal.any([controller.signal, AbortSignal.timeout(1500)])});
    if (!response.ok) throw Error();
    const data: VehicleResult = await response.json();
    if (controller.signal.aborted) return;
    if (!data?.motion || !data.observations || !Array.isArray(data.obstacles)) throw Error();
    const received = performance.now();
    requestMs.value = Math.round(received - started);
    receipts = receipts.filter(t => received - t < 1000);
    receipts.push(received);
    refreshHz.value = receipts.length;
    error.value = '';
    observedFrame.value = data;
    if (!frozen.value) timer = setTimeout(() => void load(), 100);
  } catch {
    if (controller.signal.aborted) return;
    observedFrame.value = null;
    requestMs.value = null;
    refreshHz.value = 0;
    receipts = [];
    error.value = '未收到观测结果，请检查 SENTINEL 服务连接。';
    if (!frozen.value) timer = setTimeout(() => void load(), 500);
  }
}
function toggle() {
  frozen.value = !frozen.value;
  if (frozen.value) cancel();
  else void load();
}
watch(driving, enabled => {
  store.videoSource = {type:'mock'};
  if (enabled && frozen.value) toggle();
});
watch(radarOnly, enabled => {
  if (driving.value) {
    if (drive.expanded.value) drive.enlarge();
    else drive.stop();
  }
  if (enabled) {
    cancel();
    observedFrame.value = null;
    error.value = '';
  } else if (!frozen.value) void load();
});
watch(stationaryPose, () => {
  observedFrame.value = null;
  if (!radarOnly.value && !frozen.value) void load();
  else cancel();
});
onMounted(() => {
  void load();
  void fetch(new URL('/api/health', endpoint), {signal:AbortSignal.timeout(1500)}).then(r => r.json()).then(h => {
    originalMonitor.value = h.recordingAvailable || h.source === 'recording' ? '历史实测回放' : h.source === 'live' ? '原实时驾驶舱' : '';
  }).catch(() => {});
});
onUnmounted(() => {
  cancel();
  if (store.videoSource.url?.startsWith('blob:')) URL.revokeObjectURL(store.videoSource.url);
  Object.assign(store, previous);
});
</script>

<template>
  <main class="vehicle-platform">
    <div class="cockpit-stage vehicle-stage">
      <StatusBar class="vehicle-header" vehicle :driving="driving" :radar-only="radarOnly" :status-text="observationStatus" :refresh-hz="store.playing ? refreshHz : 0" :request-ms="requestMs" @toggle="toggle" />
      <div class="glass-panel vehicle-navigation">
        <nav class="view-tabs" aria-label="感知视图">
          <button v-for="tab in tabs" :key="tab.id" :class="{active:view===tab.id}" :aria-pressed="view===tab.id" @click="openView(tab.id)">
            <UiIcon :name="tab.icon" :size="18" />{{ tab.name }}
          </button>
        </nav>
        <div class="view-actions">
          <div v-if="driving" class="detection-modes" role="group" aria-label="检测方式">
            <button v-for="mode in detectionModes" :key="mode.id" type="button" :aria-pressed="detectionMode === mode.id" @click="openDetection(mode.id)">{{ mode.name }}</button>
          </div>
          <span v-if="!driving && view!=='overview' && frame" class="detail-action">{{ actions[frame.motion.action] }} · {{ frame.motion.speedLimitMps.toFixed(2) }} m/s</span>
          <router-link v-if="originalMonitor||route.query.from==='cockpit'" class="back-link" to="/">{{ originalMonitor||'原驾驶舱' }}</router-link>
        </div>
      </div>
      <p v-if="error" class="connection" role="alert">{{ error }} <button @click="load()">重试</button></p>

      <div class="vehicle-layout" :class="{'detail-layout':view!=='overview' && !driving, 'drive-layout':driving}">
        <Dashboard v-if="view!=='overview' && view!=='drive'" :vehicle-view="view" />
        <template v-else>
        <div class="vehicle-sensors" :class="{'radar-only':radarOnly}">
          <VehicleSensorPanel v-if="!radarOnly" kind="camera" :result="frame">
            <template #camera>
              <Teleport defer to=".vehicle-platform" :disabled="!driving || !drive.expanded.value">
                <div class="vehicle-camera" :class="{'camera-expanded':driving && drive.expanded.value}">
                  <SceneViewport mode="camera" :targets="store.frame.targets" :time="store.frame.timestamp/1000" compact :drive-preview="driving" @preview-open="drive.stop" />
                  <span v-if="store.videoSource.type!=='mock'" class="preview-source">本地预览，未参与融合</span>
                  <span v-else-if="cameraHeld" class="preview-source">监控中断 · 上一帧</span>
                  <span v-else-if="driving && !frame?.capture?.vision" class="camera-offline"><UiIcon name="camera" :size="27"/>固定摄像头未连接</span>
                  <span v-else-if="driving" class="preview-source">{{ cameraInFusion ? '实时实拍 · 参与融合' : '实时预览，未参与融合' }}</span>
                  <button class="expand-camera" :aria-label="drive.expanded.value?'关闭放大画面':'展开摄像头感知'" @click="driving ? drive.enlarge() : openView('camera')"><UiIcon name="focus" :size="16"/></button>
                </div>
              </Teleport>
              <div class="calibration-actions">
                <button type="button" @click="openCalibration">地面标定</button>
              </div>
              <CameraDetectionPicker :endpoint="endpoint" />
            </template>
          </VehicleSensorPanel>
          <VehicleSensorPanel kind="lidar" :result="frame" :radar-only="radarOnly"
            :hardware-lidar="!radarOnly && frame?.field ? undefined : hardwareLidar" />
        </div>
        <section class="glass-panel field-panel" :aria-label="riskTitle">
          <div class="panel-top">
            <div class="section-heading"><h2>{{ riskTitle }}</h2></div>
            <span class="status" :class="{ muted: !frame?.field }" :title="riskHeld ? fusionEmptyText : undefined"><i class="live-dot" />{{ riskHeld ? '观测中断 · 上一帧' : observationStatus }}</span>
          </div>
          <div class="map-toolbar">
            <span>{{ driving && !radarOnly ? '融合结果仅显示 · 实车停车依据车载雷达' : '实车车身坐标系' }}{{ radarTrial ? ' · 雷达停车阈值 ' + Math.round(radarTrial.stopDistanceM * 100) + ' cm' : '' }}</span>
            <div class="map-options" aria-label="图层">
              <button :aria-pressed="showCorridor" @click="showCorridor = !showCorridor">通道</button>
              <button :aria-pressed="showContours" @click="showContours = !showContours">等值线</button>
            </div>
          </div>
          <form v-if="driving && !radarOnly" class="stationary-fusion" aria-label="静止融合位姿" @submit.prevent="confirmStationaryPose">
            <strong>静止融合</strong>
            <label>X（米） <input v-model="poseInput.xM" type="number" step="any" min="-1000" max="1000" required :disabled="!!stationaryPose" /></label>
            <label>Y（米） <input v-model="poseInput.yM" type="number" step="any" min="-1000" max="1000" required :disabled="!!stationaryPose" /></label>
            <label>朝向（°） <input v-model="poseInput.headingDeg" type="number" step="any" min="-360" max="360" required :disabled="!!stationaryPose" /></label>
            <button v-if="stationaryPose" type="button" @click="finishStationaryFusion">完成并恢复驾驶</button>
            <button v-else type="submit" :disabled="!stationaryId">确认位置并开始</button>
            <p v-if="!stationaryPose && !stationaryId">连接串口，等待两路轮速归零。</p>
            <p v-else>以雷达中心为位置，沿用地面标定原点。车头朝 +Y 为 0°，朝 +X 为 90°。</p>
          </form>
          <VehicleRiskMap :result="displayedRisk" :corridor="showCorridor" :contours="showContours"
            :empty-text="fusionEmptyText" />
          <footer class="plot-legend">
            <span class="corridor-key"><i />前方通道<span v-if="displayedRisk?.field"> · 宽 {{ Math.round(displayedRisk.field.corridorHalfWidthM * 200) }} cm</span></span>
            <span class="color-key">相对风险 <small>0</small><i :style="{ background: vehicleFieldLegend }" /><small>1</small></span>
          </footer>
        </section>

        <aside class="vehicle-rail">
          <DriveStatus v-if="driving" :state="drive.snapshot.value" :direction="drive.direction.value" :locked="drive.locked.value"
            :stationary-fusion="!!stationaryPose" @telemetry="drive.setTelemetry" @radar-trial="drive.setRadarTrial" />
          <section v-else class="glass-panel decision-panel" aria-label="小车应执行的动作">
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
          <section class="glass-panel observations" :aria-label="targetsTitle">
            <div class="panel-top"><div class="section-heading"><h2>{{ targetsTitle }}</h2></div>
              <span class="total">{{ displayedRisk?.field ? (riskHeld ? '上一帧 · ' : '') + displayedRisk.obstacles.length + ' 个目标' : radarOnly ? '等待扫描' : '等待融合' }}</span>
            </div>
            <div v-if="displayedRisk?.obstacles.length" class="target-scroll" tabindex="0" :aria-label="targetsTitle + '坐标'">
              <table><thead><tr><th>观测来源</th><th>横向 X</th><th>前向 Y</th></tr></thead>
                <tbody><tr v-for="(o, i) in displayedRisk.obstacles" :key="i"><td>{{ sources[o.source] }}</td><td>{{ o.xM.toFixed(2) }} m</td><td>{{ o.yM.toFixed(2) }} m</td></tr></tbody>
              </table>
            </div>
            <p v-else class="no-targets">{{ displayedRisk?.field ? (riskHeld ? '上一帧未发现障碍' : '当前帧未发现障碍') : '等待有效观测' }}</p>
          </section>
        </aside>
        </template>

        <section v-if="driving" class="glass-panel drive-keys" aria-label="键盘驾驶">
          <div class="section-heading"><h2>键盘驾驶</h2></div>
          <div class="key-groups">
            <span v-for="group in keyGroups" :key="group.label">
              <kbd v-for="[code,label] in group.keys" :key="code" :class="{pressed:drive.held.value.has(code)}">{{ label }}</kbd>{{ group.label }}
            </span><small>松键即停</small>
          </div>
          <button v-if="bench" class="transport" @click="drive.setRadarTrial(false)">退出最终测试</button>
        </section>
      </div>
    </div>
    <GroundCalibrationDialog v-if="calibrating" :endpoint="endpoint" @close="calibrating = false" />
  </main>
</template>

<style scoped src="./vehicle.css"></style>
