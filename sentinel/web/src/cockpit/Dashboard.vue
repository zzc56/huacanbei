<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue';
import { useRoute } from 'vue-router';
import { useSceneStore } from './stores/scene';
import { useScene } from './composables/useScene';
import StatusBar from './components/StatusBar.vue';
import LiveControls from './components/LiveControls.vue';
import CameraDetectionPicker from './components/CameraDetectionPicker.vue';
import TargetInspector from './components/TargetInspector.vue';
import SceneViewport from './components/SceneViewport.vue';
import OverviewPanel from './components/OverviewPanel.vue';
import ReplayImport from './components/ReplayImport.vue';
import ReplayLibrary from './components/ReplayLibrary.vue';
import UiIcon from './components/UiIcon.vue';
import { cameraTargetIcon, targetDisplayName } from './core/targetLabels';
import type { ViewMode } from './renderers/lightScene';
import type { MonitorSource } from './services/stream';
import type { ReplayRecording } from './data/bundledReplay';
import { replayPlaybackRates } from './types';
import type { Target } from './types';
import './styles.css';
import './field-console.css';
const props = withDefaults(defineProps<{ source?: MonitorSource; bundledReplay?: boolean }>(), { source:'live' });
const route = useRoute();
const cameraEndpoint = new URL(import.meta.env.VITE_STREAM_URL || 'http://127.0.0.1:3001', window.location.href);
if (cameraEndpoint.protocol === 'ws:') cameraEndpoint.protocol = 'http:';
if (cameraEndpoint.protocol === 'wss:') cameraEndpoint.protocol = 'https:';
const vehicleRoute = computed(() => ({
  name: 'vehicle',
  query: {
    view: 'drive',
    from: props.source === 'recording' ? 'history' : 'live',
    ...(route.query.view === 'data' ? { replay: 'data' } : {}),
  },
}));
const emit = defineEmits<{ changeSource: [source: MonitorSource] }>();
const imported = shallowRef<ReplayRecording>();
const replayName = computed(() => {
  const current = imported.value;
  return current?.name ?? (current && 'video' in current ? current.video.name : props.bundledReplay ? '内置演示' : '回放服务');
});
function applyReplay(recording: ReplayRecording) {
  imported.value = recording;
}
function showDemo() {
  imported.value = undefined;
  emit('changeSource', 'recording');
}
const sources = [
  { id: 'live', label: '实时连接' },
  { id: 'recording', label: '历史回放' },
] as const;
const store = useSceneStore(),
  { renderTargets, time } = useScene(() => ({
    source: props.source,
    bundledReplay: props.bundledReplay,
    imported: props.source === 'recording' ? imported.value : undefined,
  }));
const replayDragPosition = ref<number>();
const replayPosition = computed(() => replayDragPosition.value ?? store.frame.replay?.positionMs ?? 0);
const replayProgress = computed(() => {
  const duration = store.frame.replay?.durationMs ?? 0;
  return duration > 0 ? Math.min(100, replayPosition.value / duration * 100) : 0;
});
function seekReplay(event: Event) {
  store.seek((event.target as HTMLInputElement).valueAsNumber);
  replayDragPosition.value = undefined;
}
watch(() => store.replayVideo, () => { replayDragPosition.value = undefined; });
const mode = ref<ViewMode | 'overview'>('overview'),
  filter = ref('all');
const tabs = [
  { id: 'overview', name: '总览', en: 'OVERVIEW' },
  { id: 'radar', name: '雷达探测', en: 'RADAR PPI' },
  { id: 'camera', name: '摄像头感知', en: 'CAMERA VIEW' },
  { id: 'risk', name: '风险场', en: 'RISK FIELD' },
] as const;
const tabList = ref<HTMLElement>();
const highlightStyle = shallowRef<{ transform: string; width: string; height: string }>();
const animateHighlight = ref(false);
let tabObserver: ResizeObserver | undefined;

function placeHighlight(animate: boolean) {
  const active = tabList.value?.querySelector<HTMLButtonElement>('button[aria-selected="true"]');
  if (!active) return;
  const inset = 3;
  const next = {
    transform: `translate3d(${active.offsetLeft + inset}px,${active.offsetTop + inset}px,0)`,
    width: `${Math.max(0, active.offsetWidth - inset * 2)}px`,
    height: `${Math.max(0, active.offsetHeight - inset * 2)}px`,
  };
  const previous = highlightStyle.value;
  if (previous?.transform === next.transform && previous.width === next.width && previous.height === next.height) return;
  animateHighlight.value = animate && !!previous;
  highlightStyle.value = next;
}
watch(mode, () => placeHighlight(true), { flush: 'post' });
onMounted(() => {
  if (!tabList.value) return;
  placeHighlight(false);
  tabObserver = new ResizeObserver(() => placeHighlight(false));
  tabObserver.observe(tabList.value);
  tabList.value.querySelectorAll('button').forEach(button => tabObserver?.observe(button));
});
onUnmounted(() => tabObserver?.disconnect());
const filters = computed(() =>
  mode.value === 'camera'
    ? [
        ['all', '全部'],
        ['car', '车辆'],
        ['truck', '货车'],
        ['person', '行人'],
        ['sports ball', '球'],
      ]
    : [
        ['all', '全部'],
        ['high', '高风险'],
        ['mid', '中风险'],
        ['low', '低风险'],
      ],
);
const presentedCameraTargets = shallowRef<Target[] | null>(null);
const cameraTargets = computed(() => props.source === 'live'
  ? presentedCameraTargets.value ?? [] : store.frame.targets.filter(t => t.camera || t.groundObservation));
const cameraSelection = computed(() => cameraTargets.value.find(target => target.id === store.selectedId)?.camera);
watch([mode, () => props.source], () => {
  filter.value = 'all';
});
const targets = computed(() =>
  (mode.value === 'camera' ? cameraTargets.value : store.frame.targets)
    .filter((t) => {
      const v = t.risk?.value;
      if (mode.value === 'camera')
        return (!!t.camera || !!t.groundObservation) && (filter.value === 'all' || (t.camera?.class ?? t.kind) === filter.value);
      if (mode.value === 'radar' && !t.radar) return false;
      if (mode.value === 'risk' && (!t.fusion || (store.usesRadarMeasurements && !t.radar))) return false;
      return (
        filter.value === 'all' ||
        v !== undefined && (filter.value === 'high'
          ? v >= 0.75
          : filter.value === 'mid'
            ? v >= 0.4 && v < 0.75
            : v < 0.4)
      );
    })
    .sort((a, b) => (b.risk?.value ?? 0) - (a.risk?.value ?? 0)),
);
</script>
<template>
  <main class="cockpit-viewport">
    <div class="cockpit-stage console-stage">
      <StatusBar :switch-to="vehicleRoute">
        <LiveControls v-if="source === 'live'" />
      </StatusBar>
      <div class="monitor-toolbar">
        <div ref="tabList" class="view-tabs" role="tablist" aria-label="感知视图">
          <span v-if="highlightStyle" class="tab-highlight" :class="{ sliding: animateHighlight }"
            :style="highlightStyle" aria-hidden="true" />
          <button
            v-for="tab in tabs"
            :key="tab.id"
            :class="{ active: mode === tab.id }"
            role="tab"
            :aria-selected="mode === tab.id"
            @click="mode = tab.id"
          >
            <UiIcon
              :name="tab.id === 'overview' ? 'layers' : tab.id === 'camera' ? 'camera' : tab.id === 'radar' ? 'radar' : 'risk'"
            /><span>{{ tab.name }}</span
            >
          </button>
        </div>
        <div class="view-indicator">
          <div v-if="source === 'recording'" class="replay-source">
            <span class="replay-name" :title="replayName">{{ replayName }}</span>
            <ReplayImport @imported="applyReplay" />
            <button v-if="imported || !bundledReplay" class="replay-demo-button" type="button" @click="showDemo">演示数据</button>
          </div>
          <ReplayLibrary :source="source" :current="imported" :bundled="bundledReplay" :name="replayName" @open-replay="applyReplay" />
          <div v-if="source === 'recording' && store.frame.replay" class="replay-timeline">
            <input
              type="range"
              aria-label="实测回放进度"
              min="0"
              :max="store.frame.replay.durationMs"
              step="100"
              :value="replayPosition"
              :style="{ '--replay-progress': `${replayProgress}%` }"
              @input="replayDragPosition = ($event.target as HTMLInputElement).valueAsNumber"
              @change="seekReplay"
              @blur="replayDragPosition = undefined"
            />
            <span>{{ (replayPosition / 1000).toFixed(1) }} / {{ (store.frame.replay.durationMs / 1000).toFixed(1) }} s</span>
            <select v-model="store.replayPlaybackRate" aria-label="回放倍速">
              <option v-for="rate in replayPlaybackRates" :key="rate" :value="rate">{{ rate }}×</option>
            </select>
            <button type="button" aria-label="从头回放" @click="store.seek(0)">↺</button>
          </div>
          <div class="source-modes" role="group" aria-label="数据模式">
            <button
              v-for="item in sources"
              :key="item.id"
              type="button"
              :aria-pressed="source === item.id"
              @click="emit('changeSource', item.id)"
            >{{ item.label }}</button>
          </div>
        </div>
      </div>
      <div class="monitor-layout" :class="mode === 'overview' ? 'overview-layout' : 'detail-layout'">
        <TargetInspector v-if="mode !== 'overview'"
          :bundled-replay="source === 'recording' && bundledReplay && !imported" />
        <section class="monitor-main glass-panel">
          <OverviewPanel v-if="mode === 'overview'" :targets="renderTargets" :time="time" @open="mode = $event" />
          <div v-else class="monitor-content">
            <SceneViewport :mode="mode" :targets="renderTargets" :time="time" @camera-presented="presentedCameraTargets = $event" />
            <aside class="monitor-rail">
              <section class="rail-context">
                <template v-if="mode === 'risk'"
                  ><div class="section-heading">
                    <h3>风险等级</h3>
                    <UiIcon name="layers" :size="18" />
                  </div>
                  <div
                    class="legend-item"
                    v-for="item in [
                      { name: '高风险', range: '0.75 – 1.00', color: '#d86650' },
                      { name: '中风险', range: '0.40 – 0.75', color: '#b8a36f' },
                      { name: '低风险', range: '0.20 – 0.40', color: '#33b2a1' },
                      { name: '低场值', range: '0.00 – 0.20', color: '#a6c7c3' },
                    ]"
                    :key="item.name"
                  >
                    <i :style="{ background: item.color }" /><b>{{ item.name }}</b
                    ><span>{{ item.range }}</span>
                  </div>
                  <p class="context-note">{{ store.frame.live ? store.frame.live.fusion.message : store.frame.source==='recording' ? '保存的研究风险场 · 掩码外未知' : store.connection==='mock' ? '演示风险模型 · 公式可替换' : '后端风险场 · 未提供区域未知' }}</p></template
                >
                <template v-else-if="mode === 'radar'"
                  ><div class="section-heading">
                    <h3>探测概况</h3>
                    <UiIcon name="radar" :size="18" />
                  </div>
                  <div class="sensor-stat">
                    <span>探测半径</span><strong>{{ store.frame.radarRange ?? 200 }}<small> m</small></strong>
                  </div>
                  <div class="sensor-details">
                    <span>距离环<b>{{ (store.frame.radarRange ?? 200)/4 }} m</b></span
                    ><span>方位范围<b>0 – 360°</b></span
                    ><span
                      >雷达目标<b>{{ store.frame.targets.filter((t) => t.radar).length }}</b></span
                    >
                    <template v-if="store.frame.live">
                      <span>连接状态<b>{{
                        store.frame.live.radar.state === 'streaming' ? '实物雷达在线'
                          : store.frame.live.radar.state === 'unconfigured' ? '请在雷达设置填写设备地址'
                          : store.frame.live.radar.state === 'awaiting-data' ? '等待雷达报文'
                          : store.frame.live.radar.error === 'EADDRNOTAVAIL' ? '雷达网卡未就绪'
                          : store.frame.live.radar.state === 'stale' ? '数据超时' : '连接中 / 断开'
                      }}</b></span>
                      <span>设备地址<b>{{ store.frame.live.radar.endpoint || '—' }}</b></span>
                      <span>接收周期<b>{{ store.frame.live.radar.cycles }}</b></span>
                      <span>累计目标记录<b>{{ store.frame.live.radar.totalTargets }}</b></span>
                      <span>数据新鲜度<b>{{ store.frame.live.radar.ageMs===null ? '—' : store.frame.live.radar.ageMs+' ms' }}</b></span>
                    </template>
                  </div></template
                >
                <template v-else
                  ><div class="section-heading">
                    <h3>视觉感知</h3>
                    <UiIcon name="camera" :size="18" />
                  </div>
                  <CameraDetectionPicker v-if="source === 'live'" :endpoint="cameraEndpoint" presets-only />
                  <div class="sensor-stat">
                    <span>当前视觉目标</span
                    ><strong
                      >{{
                        String(cameraTargets.length).padStart(2, '0')
                      }}<small> OBJECTS</small></strong
                    >
                  </div>
                  <div class="sensor-details">
                    <span
                      >观测源<b>{{ store.frame.live ? '网络摄像头 · '+(store.frame.live.camera.state==='streaming'?'实时':'待连接') : store.frame.source==='recording' ? '实测录像' : store.videoSource.type.toUpperCase() }}</b></span
                    ><span
                      >{{ store.frame.source==='live' ? '雷视关联' : store.frame.source==='recording' ? '原始检测记录' : '融合目标' }}<b>{{
                        store.frame.source==='live' && store.frame.live?.association?.state !== 'active' ? '—'
                          : store.frame.recordingCounts?.detections ?? store.frame.targets.filter((t) => t.camera && t.radar).length
                      }}</b></span
                    ><span
                      >选中置信度<b>{{
                        cameraSelection
                          ? cameraSelection.previewOnly ? '预览' : (cameraSelection.confidence * 100).toFixed(1) + '%'
                          : '—'
                      }}</b></span
                    >
                  </div></template
                >
              </section>
              <section class="target-list-panel">
                <div class="section-heading">
                  <h3>目标列表</h3>
                  <UiIcon name="filter" :size="19" />
                </div>
                <div class="target-filters">
                  <button
                    v-for="[id, label] in filters"
                    :key="id"
                    :class="{ active: filter === id }"
                    @click="filter = id"
                  >
                    {{ label }}
                  </button>
                </div>
                <div class="target-list">
                  <button
                    v-for="target in targets"
                    :key="target.id"
                    class="target-row"
                    :class="{
                      selected: store.selectedId === target.id,
                      high: (target.risk?.value ?? 0) >= 0.75,
                      mid: (target.risk?.value ?? 0) >= 0.4 && (target.risk?.value ?? 0) < 0.75,
                    }"
                    :aria-pressed="store.selectedId === target.id"
                    :aria-label="'选择目标 ' + targetDisplayName(target)"
                    @click="store.select(target.id)"
                  >
                    <span class="target-row-icon"
                      ><UiIcon
                        :name="mode === 'camera' ? cameraTargetIcon(target) : 'focus'"
                        :size="24" /></span
                    ><span class="target-row-body"
                      ><b
                        >{{ targetDisplayName(target)
                        }}<small>{{
                          !target.risk ? '未知' : target.risk.value >= 0.75
                            ? '高风险'
                            : (target.risk?.value ?? 0) >= 0.4
                              ? '中风险'
                              : '低风险'
                        }}</small></b
                      ><span
                        ><strong>{{ mode==='camera' && target.camera ? target.camera.previewOnly ? '预览' : (target.camera.confidence*100).toFixed(1)+'%' : target.risk?.value.toFixed(2) }}</strong
                        ><small>{{
                          mode==='camera' ? target.camera?.class : target.autoAssociation?.status === 'matched' || target.autoAssociation?.method === 'offline-trajectory-fit' ? '雷视关联' : target.autoAssociation ? '暂定轨迹关联' : target.radar ? (target.camera ? '已融合' : '仅雷达') : '仅视觉'
                        }}</small></span
                      ></span
                    ><UiIcon name="chevron" :size="15" />
                  </button>
                  <div v-if="!targets.length" class="empty-state">暂无该等级目标</div>
                </div>
                <div class="list-foot">
                  <span>{{ targets.length }} 个目标</span
                  ><span>点击同步定位 <UiIcon name="link" :size="13" /></span>
                </div>
              </section>
            </aside>
          </div>
        </section>
      </div>
    </div>
  </main>
</template>

<style scoped>
.view-tabs { position: relative; isolation: isolate; }
.tab-highlight {
  position: absolute;
  top: 0;
  left: 0;
  border-radius: 8px;
  background: #cdebee;
  box-shadow: inset 0 0 0 1px #00798245;
  pointer-events: none;
}
.tab-highlight.sliding {
  transition: transform .39s cubic-bezier(.22,.76,.3,1.16),
    width .39s cubic-bezier(.22,.76,.3,1.16),
    height .39s cubic-bezier(.22,.76,.3,1.16);
}
.monitor-toolbar .view-tabs > button { z-index: 1; }
.monitor-toolbar .view-tabs > button.active { background: transparent; }
.monitor-toolbar .view-tabs > button.active::after { display: none; }
.monitor-toolbar .view-tabs > button:focus-visible { outline: 2px solid #16767e; outline-offset: -4px; }
@media (prefers-reduced-motion: reduce) {
  .tab-highlight.sliding { transition: none; }
}
</style>
