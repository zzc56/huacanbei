<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import type { StationaryPose, VehicleResult } from '../../../sentinel-backend/src/vehicle/contracts';
import type { Target } from './types';
import StatusBar from './components/StatusBar.vue';
import UiIcon from './components/UiIcon.vue';
import { vehicleFieldLegend } from './core/fieldColors';
import './styles.css';
import './field-console.css';
import VehicleRiskMap from './components/VehicleRiskMap.vue';
import VehicleSensorPanel from './components/VehicleSensorPanel.vue';
import SceneViewport from './components/SceneViewport.vue';
import { vehicleScene } from './core/vehicleScene';
import { cameraTargetIcon, targetDisplayName } from './core/targetLabels';
import { useSceneStore } from './stores/scene';
import { RealDataAdapter } from '../core/RealDataAdapter';
import { useVehicleDrive } from './composables/useVehicleDrive';
import DriveStatus from './components/DriveStatus.vue';
import GroundCalibrationDialog from './components/GroundCalibrationDialog.vue';
import CameraDetectionPicker from './components/CameraDetectionPicker.vue';

const route = useRoute();
const router = useRouter();
const endpoint = new URL(import.meta.env.VITE_STREAM_URL || 'http://127.0.0.1:3001', window.location.href);
if (endpoint.protocol === 'ws:') endpoint.protocol = 'http:';
if (endpoint.protocol === 'wss:') endpoint.protocol = 'https:';
const base = endpoint.origin + '/api/vehicle/';
const calibrating = ref(false);
const stationaryPose = shallowRef<StationaryPose | null>(null);
const poseInput = ref<{xM:number|''; yM:number|''; headingDeg:number|''}>({xM:'',yM:'',headingDeg:''});
const keyboardBlocked = computed(() => calibrating.value || stationaryPose.value !== null);
const drive = useVehicleDrive(computed(() => route.name === 'vehicle'), endpoint, keyboardBlocked);
function openCalibration() {
  if (drive.expanded.value) drive.enlarge();
  else drive.stop();
  drive.setRadarTrial(false);
  drive.setDriveOrigin(null);
  calibrating.value = true;
}
const detectionModes = [{id:'radar', name:'只有雷达检测'}, {id:'fusion', name:'摄像头和雷达融合检测'}] as const;
const detectionMode = computed(() => route.query.detection === 'fusion' ? 'fusion' : 'radar');
const radarOnly = computed(() => detectionMode.value === 'radar');
function openDetection(mode: typeof detectionModes[number]['id']) {
  if (detectionMode.value !== mode) void router.push({name:'vehicle', query:{...route.query, detection:mode}});
}
const bench = computed(() => drive.snapshot.value?.bench);
const radarTrial = computed(() => bench.value?.radarTrial);
const odometry = computed(() => drive.snapshot.value?.odometry);
const cameraInFusion = computed(() => {
  const sample = frame.value?.observations.camera;
  const image = displayedCamera.value?.vision;
  return !!sample?.includedInFusion && !!image &&
    sample.sequence === image.sequence && sample.capturedAtMs === Date.parse(image.captured_utc);
});
const hardwareLidar = computed(() => drive.snapshot.value?.telemetry?.lidar);
const stationaryId = computed(() => drive.snapshot.value?.telemetry?.stationaryId);
function confirmedPose(): StationaryPose | undefined {
  const {xM,yM,headingDeg} = poseInput.value;
  const id = stationaryId.value;
  if (bench.value || !id || xM === '' || yM === '' || headingDeg === '' ||
      !Number.isFinite(xM) || !Number.isFinite(yM) || !Number.isFinite(headingDeg) ||
      Math.abs(xM) > 1000 || Math.abs(yM) > 1000 || Math.abs(headingDeg) > 360) return;
  return {xM,yM,headingDeg,stationaryId:id};
}
function confirmStationaryPose() {
  const origin = confirmedPose();
  if (!origin) return;
  drive.setDriveOrigin(null);
  stationaryPose.value = origin;
}
function startDriveOdometry() {
  const origin = confirmedPose();
  if (!origin) return;
  drive.setDriveOrigin(origin);
  stationaryPose.value = null;
}
const overviewRoute = computed(() => route.query.from === 'history'
  ? { name:'history', query:route.query.replay === 'data' ? {view:'data'} : {} }
  : { name:'home', query:{mode:'live'} });
const sources = { camera: '固定摄像头', lidar: '车载雷达', both: '摄像头 + 雷达' };
const keyGroups = [
  {label:'按住前进', keys:[['KeyW','W'],['ArrowUp','↑']]},
  {label:'立即停车', keys:[['Space','空格']]},
] as const;
const observedFrame = shallowRef<VehicleResult | null>(null);
const liveFusion = computed(() => drive.snapshot.value?.fusionRisk);
const frame = computed(() => {
  if (radarOnly.value) return drive.snapshot.value?.radarRisk ?? null;
  if (!stationaryPose.value && liveFusion.value) return liveFusion.value;
  const current = observedFrame.value;
  if (!current?.field || stationaryPose.value &&
      (current.observations.camera?.includedInFusion && current.observations.lidar?.includedInFusion)) return current;
  return { ...current, observations: { camera:current.observations.camera, lidar:null },
    field:null, obstacles:[], corridorRisk:null, closestForwardM:null, cameraCount:null, lidarCount:null };
});
const riskTitle = computed(() => radarOnly.value ? '车载雷达风险场' : '融合风险场');
const targetsTitle = computed(() => radarOnly.value ? '雷达目标' : '融合目标');
const lastRiskFrame = shallowRef<VehicleResult | null>(null);
const lastCameraCapture = shallowRef<VehicleResult['capture']>();
const ballNumbers = new Map<string, number>();
const displayedRisk = computed(() => frame.value?.field ? frame.value : lastRiskFrame.value);
const riskHeld = computed(() => !!displayedRisk.value && !frame.value?.field);
const displayedCamera = computed(() => {
  if (radarOnly.value) return undefined;
  const incoming = frame.value?.capture;
  const previous = lastCameraCapture.value;
  if (liveFusion.value && !stationaryPose.value && incoming?.vision) return incoming;
  if (!incoming?.vision) return previous ?? incoming;
  if (previous?.vision && incoming.vision.captured_utc < previous.vision.captured_utc) return previous;
  return incoming;
});
const cameraHeld = computed(() => !!displayedCamera.value?.vision && displayedCamera.value !== frame.value?.capture);
const displayedFrame = computed(() => {
  const result = displayedRisk.value ?? frame.value;
  const capture = displayedCamera.value;
  return result && capture && result.capture !== capture ? { ...result, capture } : result;
});
watch(frame, current => {
  if (current?.field) lastRiskFrame.value = current;
  if (displayedCamera.value?.vision) lastCameraCapture.value = displayedCamera.value;
}, {flush:'sync'});
watch([radarOnly, stationaryPose], () => { lastRiskFrame.value = null; }, {flush:'sync'});
const waitingForStationaryFusion = {
  waiting_for_pose:'小车移动或轮速反馈中断，请重新确认位置和朝向',
  waiting_for_radar:'等待新鲜的车载雷达扫描',
  waiting_for_camera:'等待有效的监控观测与地面标定',
  waiting_for_sync:'等待采集时间接近的监控帧和雷达扫描',
  aligned:'',
};
const fusionEmptyText = computed(() => {
  if (radarOnly.value) return '等待车载雷达有效扫描';
  const state = frame.value?.stationaryFusion;
  if (stationaryPose.value) return state ? waitingForStationaryFusion[state] : '正在读取实时融合数据';
  if (odometry.value?.status === 'tracking') return '已设置行驶起点，等待有效且时间对齐的摄像头与雷达观测';
  return '小车停稳后，请设置行驶起点';
});
const store = useSceneStore();
const previous = {frame:store.frame, selectedId:store.selectedId, playing:store.playing, connection:store.connection, videoSource:store.videoSource};
store.videoSource = {type:'mock'};
store.playing = true;
const presentedCameraTargets = shallowRef<Target[] | null>(null);
const visibleBalls = computed(() => store.videoSource.type === 'mock'
  ? presentedCameraTargets.value?.filter(target => target.camera?.class === 'sports ball') ?? [] : []);
watch(() => store.videoSource.url, (_, old) => { if (old?.startsWith('blob:')) URL.revokeObjectURL(old); });

const radarAdapter = new RealDataAdapter(endpoint.origin);
const fusionAdapter = new RealDataAdapter(endpoint.origin);
const error = ref('');
watch([displayedFrame, displayedCamera, error], () => {
  const adapter = radarOnly.value ? radarAdapter : fusionAdapter;
  store.frame = adapter.trails(vehicleScene(displayedFrame.value, endpoint.origin, displayedCamera.value, ballNumbers));
  store.connection = frame.value ? 'connected' : error.value ? 'error' : 'connecting';
  if (!store.frame.targets.some(t => t.id === store.selectedId)) store.select(store.frame.targets[0]?.id ?? '—');
}, {immediate:true, flush:'sync'});

const showCorridor = ref(true), showContours = ref(true);
const observationStatus = computed(() => {
  if (radarOnly.value) {
    if (frame.value?.field) return '车载雷达在线';
    return hardwareLidar.value?.status === 'stale' ? '雷达反馈超时' : '等待车载雷达';
  }
  if (error.value) return '连接中断';
  if (!frame.value) return '连接中';
  return frame.value.field ? '两路观测已对齐' : '等待融合观测';
});
const displayedStatus = computed(() => riskHeld.value ? '观测中断 · 上一帧' : observationStatus.value);
let timer: ReturnType<typeof setTimeout> | undefined, active: AbortController | undefined;
let cameraStream: EventSource | undefined;
function cancel() {
  clearTimeout(timer);
  active?.abort();
  active = undefined;
}
function receive(data: VehicleResult) {
  if (!data?.motion || !data.observations || !Array.isArray(data.obstacles)) throw Error();
  error.value = '';
  observedFrame.value = data;
}
function stopObservation() {
  cancel();
  cameraStream?.close();
  cameraStream = undefined;
}
function startObservation() {
  stopObservation();
  if (radarOnly.value) return;
  if (stationaryPose.value) {
    void load();
    return;
  }
  const stream = new EventSource(new URL('camera-stream', base));
  cameraStream = stream;
  stream.onmessage = event => {
    if (cameraStream !== stream) return;
    try {
      receive(JSON.parse(event.data));
      cancel();
    } catch {
      if (!active) void load();
    }
  };
  stream.onerror = () => {
    if (cameraStream === stream && !active) void load();
  };
}
async function load() {
  if (radarOnly.value) return;
  cancel();
  const controller = new AbortController();
  active = controller;
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
    receive(data);
    timer = setTimeout(() => void load(), 100);
  } catch {
    if (controller.signal.aborted) return;
    observedFrame.value = null;
    error.value = '未收到观测结果，请检查 SENTINEL 服务连接。';
    timer = setTimeout(() => void load(), 500);
  }
}
watch(radarOnly, enabled => {
  if (drive.expanded.value) drive.enlarge();
  drive.setRadarTrial(false);
  drive.setDriveOrigin(null);
  calibrating.value = false;
  stationaryPose.value = null;
  if (enabled) {
    presentedCameraTargets.value = null;
    observedFrame.value = null;
    error.value = '';
  }
  startObservation();
});
watch(stationaryPose, () => {
  observedFrame.value = null;
  startObservation();
});
onMounted(() => {
  startObservation();
});
onUnmounted(() => {
  stopObservation();
  if (store.videoSource.url?.startsWith('blob:')) URL.revokeObjectURL(store.videoSource.url);
  Object.assign(store, previous);
});
</script>

<template>
  <main class="cockpit-viewport vehicle-platform">
    <div class="cockpit-stage console-stage vehicle-stage">
      <StatusBar vehicle :switch-to="overviewRoute" :radar-only="radarOnly" :status-text="displayedStatus" />
      <div class="monitor-toolbar vehicle-toolbar">
        <h2><UiIcon name="car" :size="20" />小车控制</h2>
        <div class="source-modes detection-modes" role="group" aria-label="检测方式">
          <button v-for="mode in detectionModes" :key="mode.id" type="button" :aria-pressed="detectionMode === mode.id" @click="openDetection(mode.id)">{{ mode.name }}</button>
        </div>
      </div>
      <p v-if="error" class="connection" role="alert">{{ error }} <button @click="load()">重试</button></p>

      <div class="vehicle-layout">
        <div class="vehicle-sensors">
          <VehicleSensorPanel class="vehicle-card" kind="lidar" :result="frame" :radar-only="radarOnly"
            :hardware-lidar="hardwareLidar" />
          <section v-if="radarOnly" class="glass-panel vehicle-card camera-placeholder" aria-label="固定摄像头观测">
            <div class="section-heading"><h2>固定摄像头</h2></div>
            <div class="vehicle-camera">
              <p class="camera-offline"><UiIcon name="camera" :size="27" />摄像头未连接</p>
            </div>
          </section>
          <VehicleSensorPanel v-else class="vehicle-card" kind="camera" :result="frame">
            <template #camera>
              <Teleport defer to=".vehicle-platform" :disabled="!drive.expanded.value">
                <div class="vehicle-camera" :class="{'camera-expanded':drive.expanded.value}">
                  <SceneViewport mode="camera" :targets="store.frame.targets" :time="store.frame.timestamp/1000" compact drive-preview
                    @preview-open="drive.stop" @camera-presented="presentedCameraTargets = $event" />
                  <span v-if="store.videoSource.type!=='mock'" class="preview-source">本地预览，未参与融合</span>
                  <span v-else-if="cameraHeld" class="preview-source">监控画面 · 上一帧</span>
                  <span v-else-if="!frame?.capture?.vision" class="camera-offline"><UiIcon name="camera" :size="27"/>固定摄像头未连接</span>
                  <span v-else class="preview-source">{{ cameraInFusion ? '实时实拍 · 参与融合' : '实时预览，未参与融合' }}</span>
                  <button class="expand-camera" :aria-label="drive.expanded.value?'关闭放大画面':'展开摄像头感知'" @click="drive.enlarge()"><UiIcon name="focus" :size="16"/></button>
                </div>
              </Teleport>
              <div v-if="visibleBalls.length" class="camera-ball-targets" aria-label="画面中的球">
                <span v-for="target in visibleBalls" :key="target.id">
                  <UiIcon :name="cameraTargetIcon(target)" :size="16" />{{ targetDisplayName(target) }}{{ target.camera?.previewOnly ? ' · 预览' : '' }}
                </span>
              </div>
              <div class="calibration-actions">
                <button type="button" @click="openCalibration">地面标定</button>
              </div>
              <CameraDetectionPicker :endpoint="endpoint" />
            </template>
          </VehicleSensorPanel>
        </div>
        <section class="glass-panel vehicle-card field-panel" :aria-label="riskTitle">
          <div class="panel-top">
            <div class="section-heading"><h2>{{ riskTitle }}</h2></div>
            <span class="status" :class="{ muted: !frame?.field }" :title="riskHeld ? fusionEmptyText : undefined"><i class="live-dot" />{{ displayedStatus }}</span>
          </div>
          <div class="map-toolbar">
            <span>{{ radarOnly ? '实车车身坐标系' : stationaryPose ? '静止融合 · 驱动停用' : '实时融合 · 参与停车判定' }}{{ radarTrial ? ' · 通道停车阈值 ' + Math.round(radarTrial.stopDistanceM * 100) + ' cm' : '' }}</span>
            <div class="map-options" aria-label="图层">
              <button :aria-pressed="showCorridor" @click="showCorridor = !showCorridor">通道</button>
              <button :aria-pressed="showContours" @click="showContours = !showContours">等值线</button>
            </div>
          </div>
          <form v-if="!radarOnly" class="stationary-fusion" aria-label="小车起点与定位" @submit.prevent="startDriveOdometry">
            <strong>小车起点与定位</strong>
            <label>X（米） <input v-model="poseInput.xM" type="number" step="any" min="-1000" max="1000" required :disabled="!!stationaryPose || !!bench" /></label>
            <label>Y（米） <input v-model="poseInput.yM" type="number" step="any" min="-1000" max="1000" required :disabled="!!stationaryPose || !!bench" /></label>
            <label>朝向（°） <input v-model="poseInput.headingDeg" type="number" step="any" min="-360" max="360" required :disabled="!!stationaryPose || !!bench" /></label>
            <button type="submit" :disabled="!stationaryId || !!bench">{{ stationaryPose ? '用此位置开始行驶定位' : '设为行驶起点' }}</button>
            <button v-if="stationaryPose" type="button" @click="stationaryPose = null">返回编辑</button>
            <button v-else type="button" :disabled="!stationaryId || !!bench" @click="confirmStationaryPose">静止查看</button>
            <p v-if="odometry?.status === 'tracking'">轮速定位 · X {{ odometry.pose.xM.toFixed(2) }} m · Y {{ odometry.pose.yM.toFixed(2) }} m · 朝向 {{ odometry.pose.headingDeg.toFixed(1) }}°</p>
            <p v-else-if="odometry?.status === 'reset_required'">定位中断。小车停稳后，请重新填写当前位置和朝向。</p>
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
          <DriveStatus class="vehicle-card" :state="drive.snapshot.value" :direction="drive.direction.value" :locked="drive.locked.value"
            :detection-mode="detectionMode" :fusion-ready="!!liveFusion?.field" :stationary-fusion="!!stationaryPose"
            @telemetry="drive.setTelemetry" @radar-trial="drive.setRadarTrial($event, detectionMode)" />
          <section class="glass-panel vehicle-card observations" :aria-label="targetsTitle">
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

        <section class="glass-panel vehicle-card drive-keys" aria-label="键盘驾驶">
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
