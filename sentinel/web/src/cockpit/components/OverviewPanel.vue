<script setup lang="ts">
import { computed } from 'vue';
import type { Target } from '../types';
import type { ViewMode } from '../renderers/lightScene';
import { useSceneStore } from '../stores/scene';
import { measurementStatus } from '../../core/measurementStatus';
import SceneViewport from './SceneViewport.vue';
import UiIcon from './UiIcon.vue';

defineProps<{ targets: Target[]; time: number }>();
defineEmits<{ open: [mode: ViewMode] }>();
const store = useSceneStore();
const panels = [
  { mode: 'camera', title: '摄像头感知', subtitle: 'CAMERA / OBJECT DETECTION', index: '02', icon: 'camera' },
  { mode: 'risk', title: '风险场', subtitle: 'RISK / SPATIAL DISTRIBUTION', index: '03', icon: 'layers' },
] as const;
const radarCount = computed(() => store.frame.targets.filter(t => t.radar).length);
const cameraCount = computed(() => store.frame.targets.filter(t => t.camera).length);
const peak = computed(() => {
  const field = store.frame.riskField;
  if (!field) return null;
  let maximum: number | null = null;
  for (let i = 0; i < field.values.length; i++) {
    if (field.valid[i] && Number.isFinite(field.values[i]))
      maximum = Math.max(maximum ?? 0, field.values[i]);
  }
  return maximum;
});
const measurement = computed(() => measurementStatus(store.selected));
function status(mode: ViewMode) {
  if (['connecting', 'disconnected', 'error'].includes(store.connection))
    return { text: store.connection === 'connecting' ? '连接中' : '连接中断', ready: false };
  if (!store.playing) return { text: '显示已暂停', ready: false };
  if (store.connection === 'mock') return { text: '演示数据', ready: false };
  if (store.frame.source === 'recording') return { text: '历史实测', ready: true };
  if (mode === 'risk') return { text: store.frame.riskField ? '雷达估计' : '等待数据', ready: !!store.frame.riskField };
  const state = mode === 'radar' ? store.frame.live?.radar.state : store.frame.live?.camera.state;
  return { text: state === 'streaming' ? '实时在线' : state === 'stale' ? '数据超时' : '等待设备', ready: state === 'streaming' };
}
const fieldNote = computed(() => store.frame.live?.fusion.message ?? store.frame.message ?? '等待风险场数据');
</script>

<template>
  <div class="overview-panel">
    <div class="overview-heading">
      <div><span class="overview-kicker">MULTIMODAL OVERVIEW</span><h2>多模态感知总览</h2></div>
      <p>左侧摄像头 / 雷达小地图 · 右侧风险场 · 点击识别框查看观测信息</p>
    </div>
    <div class="overview-grid">
      <section v-for="panel in panels" :key="panel.mode" class="overview-card" :class="'overview-' + panel.mode" :aria-label="panel.title + '总览'">
        <header class="overview-card-header">
          <span class="overview-number">{{ panel.index }}</span>
          <div class="overview-card-title"><h3><UiIcon :name="panel.icon" :size="19" />{{ panel.title }}</h3><small>{{ panel.subtitle }}</small></div>
          <span class="overview-state" :class="{ ready: status(panel.mode).ready }"><i />{{ status(panel.mode).text }}</span>
          <button class="overview-expand" :aria-label="'展开' + panel.title" @click="$emit('open', panel.mode)"><UiIcon name="focus" :size="19" /></button>
        </header>
        <div class="overview-visual">
          <SceneViewport :mode="panel.mode" :targets="targets" :time="time" compact />
          <aside v-if="panel.mode === 'camera'" class="radar-minimap" aria-label="雷达小地图">
            <header class="minimap-header">
              <h3><UiIcon name="radar" :size="16" />雷达小地图</h3>
              <span class="overview-state" :class="{ ready: status('radar').ready }"><i />{{ status('radar').text }}</span>
              <button class="overview-expand" aria-label="展开雷达探测" title="展开雷达探测" @click="$emit('open', 'radar')"><UiIcon name="focus" :size="17" /></button>
            </header>
            <SceneViewport mode="radar" :targets="targets" :time="time" compact minimap />
            <footer class="minimap-footer"><span>目标 <b>{{ radarCount }}</b></span><span>半径 {{ store.frame.radarRange ?? '—' }} m</span></footer>
          </aside>
        </div>
        <footer class="overview-card-footer">
          <template v-if="panel.mode === 'camera'">
            <span>视觉目标 <b>{{ cameraCount }}</b></span>
            <span>画面尺寸 <b>{{ store.frame.cameraFrame ? store.frame.cameraFrame.width + ' × ' + store.frame.cameraFrame.height : '—' }}</b></span>
            <span v-if="store.frame.source === 'live'" title="从本机解码完成到当前画面显示的耗时，不含摄像头内部编码及取流耗时">本机画面延迟 <b>{{ store.cameraLatencyMs ?? '—' }} <small>ms</small></b></span>
            <span>帧序号 <b>{{ store.frame.cameraFrame?.sequence ?? '—' }}</b></span>
          </template>
          <template v-else>
            <span>峰值场强 <b>{{ peak?.toFixed(3) ?? '—' }}</b></span>
            <span>场域网格 <b>{{ store.frame.riskField ? store.frame.riskField.width + ' × ' + store.frame.riskField.height : '—' }}</b></span>
            <div class="overview-legend"><i /><small>低场值 → 高场值</small></div>
          </template>
        </footer>
      </section>
    </div>
    <div class="overview-bottom">
      <section class="overview-selection" aria-label="总览选中目标">
        <div class="overview-selection-title"><UiIcon name="focus" /><div><small>当前选中目标</small><strong>{{ store.selected?.id ?? '未选择目标' }}</strong></div><span>{{ store.selected ? measurement.source : '点击任一画面的目标' }}</span></div>
        <dl>
          <div><dt>实测距离</dt><dd>{{ store.selected?.radar?.range.toFixed(1) ?? '—' }} <small>m</small></dd></div>
          <div><dt>合速度</dt><dd>{{ store.selected?.fusion?.speed?.toFixed(2) ?? '—' }} <small>m/s</small></dd></div>
          <div><dt>位置场值</dt><dd>{{ store.selected?.risk?.value.toFixed(3) ?? '—' }}</dd></div>
          <div><dt>视觉置信度</dt><dd>{{ store.selected?.camera ? (store.selected.camera.confidence * 100).toFixed(1) + '%' : '—' }}</dd></div>
        </dl>
      </section>
      <aside class="overview-basis">
        <h3><UiIcon name="layers" :size="17" />风险场说明</h3>
        <p>{{ fieldNote }}</p>
        <small v-if="store.frame.source === 'live'">视觉与雷达身份尚未联合标定，目标分别展示。</small>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.overview-panel { flex: 1; min-height: 0; display: flex; flex-direction: column; gap: 10px; padding: 0 2px 2px; }
.overview-heading { display:flex; justify-content:space-between; align-items:center; padding: 0 3px; }
.overview-kicker { display:none; }
.overview-heading h2 { font-size:17px; color:#103653; margin-top:0; letter-spacing:1px; }
.overview-heading p { color:#588295; font-size:12px; padding-bottom:3px; }
.overview-grid { flex:1; min-height:0; display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1fr); grid-template-rows:minmax(0,1fr); gap:10px; }
.overview-camera { grid-column:1; }
.overview-risk { grid-column:2; }
.overview-visual { position:relative; display:flex; flex:1; min-height:0; min-width:0; }
.overview-card { display:flex; min-width:0; min-height:0; flex-direction:column; padding:0 6px; border:1px solid #a2d2df; background:#f6fcffbb; border-radius:12px; box-shadow:0 3px 14px #245a7509; }
.overview-card-header { display:flex; align-items:center; gap:10px; height:38px; flex-shrink:0; }
.overview-number { font:italic 700 25px Arial,sans-serif; color:#8abacb; letter-spacing:-1px; }
.overview-card-title { flex:1; min-width:0; display:flex; align-items:center; gap:14px; }
.overview-card-title h3 { display:flex; align-items:center; gap:7px; font-size:17px; color:#113a54; }
.overview-card-title small { display:block; font-size:8px; color:#618b9f; letter-spacing:1px; margin-top:0; }
.overview-state { display:flex; align-items:center; gap:5px; font-size:10px; color:#9b7851; white-space:nowrap; }
.overview-state i { width:5px; height:5px; border-radius:50%; background:#c29760; }
.overview-state.ready { color:#008a80; }.overview-state.ready i { background:#00b69f; }
.overview-expand { display:grid; place-items:center; width:27px; height:30px; border-radius:5px; color:#477e92; }
.overview-expand:hover { background:#d8efef; }
.overview-card :deep(.scene-viewport) { flex:1; min-height:0; border-radius:8px; box-shadow:none; }
.overview-card :deep(.scene-caption) { padding:13px 12px; font-size:10px; }
.overview-card :deep(.scene-caption > span:first-child) { max-width:66%; line-height:1.6; }
.overview-card :deep(.scene-caption-right b) { display:none; }
.overview-card :deep(.scene-caption-right) { font-size:9px; }
.overview-card :deep(.scene-bottom) { padding:12px; font-size:8px; }
.overview-card :deep(.scene-bottom > span:first-child) { max-width:65%; }
.overview-card :deep(.compass) { top:42px; left:auto; right:14px; transform:scale(.65); transform-origin:top right; }
.overview-card :deep(.scene-tools) { left:auto; right:12px; bottom:28px; padding:3px; }
.overview-card :deep(.view-notice) { max-width:90%; white-space:normal; text-align:center; top:52px; font-size:11px; padding:7px 10px; }
.overview-card :deep(.camera-location) { top:auto; left:14px; bottom:32px; padding:8px 10px; max-width:90%; opacity:.9; }
.overview-card :deep(.camera-location > span),.overview-card :deep(.camera-location strong) { display:none; }
.overview-camera :deep(.camera-location) { display:none; }
.overview-card :deep(.camera-location strong) { font-size:15px; }
.overview-camera > .overview-visual > :deep(.scene-viewport .scene-caption) { justify-content:flex-end; background:none; pointer-events:none; }
.overview-camera > .overview-visual > :deep(.scene-viewport .scene-caption > span:first-child) { display:none; }
.overview-camera > .overview-visual > :deep(.scene-viewport .scene-caption-right) { background:#f4fdffdc; border-radius:4px; padding:4px 7px; }
.radar-minimap { position:absolute; z-index:5; top:14px; left:14px; width:34%; max-width:310px; height:34%; max-height:250px; display:flex; flex-direction:column; overflow:hidden; border:1px solid #79c5d2; border-radius:10px; padding:0 5px; background:#effafa; box-shadow:0 6px 22px #082d4b40,0 0 0 2px #ffffff80; }
.minimap-header { height:30px; display:flex; align-items:center; gap:8px; flex-shrink:0; }
.minimap-header h3 { display:flex; align-items:center; gap:5px; flex:1; font-size:12px; color:#123e55; white-space:nowrap; }
.minimap-header .overview-state { font-size:9px; }
.minimap-header .overview-expand { height:26px; width:24px; }
.radar-minimap :deep(.scene-viewport) { min-height:0; border:0; border-radius:5px; }
.radar-minimap :deep(.scene-caption),.radar-minimap :deep(.scene-bottom),.radar-minimap :deep(.scene-tools),.radar-minimap :deep(.compass),.radar-minimap :deep(.scene-viewport::before),.radar-minimap :deep(.scene-viewport::after) { display:none; }
.minimap-footer { display:flex; justify-content:space-between; align-items:center; height:23px; flex-shrink:0; padding:0 6px; font-size:10px; color:#3d7084; }
.minimap-footer b { color:#087e82; font-variant-numeric:tabular-nums; }
.overview-card-footer { height:28px; display:flex; align-items:center; justify-content:space-between; gap:10px; flex-shrink:0; padding:0 5px; }
.overview-card-footer > span { font-size:10px; color:#5e8295; }
.overview-card-footer b { display:inline; font:700 16px Arial,sans-serif; color:#19415b; margin-left:9px; font-variant-numeric:tabular-nums; }
.overview-card-footer b small { font-size:10px; font-weight:400; }
.overview-legend { width:100px; }.overview-legend i { display:block; height:5px; border-radius:3px; background:linear-gradient(90deg,#8fc0c6,#79c6b4,#dfcf99,#bb6853); }
.overview-legend small { display:block; color:#6a8793; font-size:9px; margin-top:7px; text-align:center; }
.overview-bottom { display:grid; grid-template-columns:1fr 1fr; gap:10px; height:60px; flex-shrink:0; }
.overview-selection,.overview-basis { border:1px solid #b2d7e1; border-radius:10px; background:#f8fdffb8; padding:6px 12px; }
.overview-selection-title { display:flex; gap:10px; align-items:center; color:#188d90; }
.overview-selection-title > div { display:flex; align-items:baseline; gap:13px; }.overview-selection-title small { font-size:11px; color:#5d8296; }
.overview-selection-title strong { font:700 17px Arial,sans-serif; color:#173e59; }
.overview-selection-title > span { margin-left:auto; font-size:11px; color:#4b8990; }
.overview-selection dl { display:grid; grid-template-columns:repeat(4,1fr); margin:5px 0 0; gap:12px; }
.overview-selection dl > div { border-left:1px solid #cbe3e9; padding-left:15px; }.overview-selection dl > div:first-child { border:0; padding-left:0; }
.overview-selection dt { display:inline; font-size:10px; color:#668a9c; }.overview-selection dd { display:inline; margin:0 0 0 8px; font:700 16px Arial,sans-serif; color:#173e59; }.overview-selection dd small { font-size:10px; font-weight:400; color:#628497; }
.overview-basis h3 { display:flex; gap:7px; align-items:center; font-size:13px; color:#244d65; }
.overview-basis p { font-size:11px; color:#507d8d; margin-top:4px; line-height:1.45; }.overview-basis > small { display:none; }
</style>
