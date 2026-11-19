<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useSceneStore } from './stores/scene';
import { useScene } from './composables/useScene';
import StatusBar from './components/StatusBar.vue';
import TargetInspector from './components/TargetInspector.vue';
import SceneViewport from './components/SceneViewport.vue';
import OverviewPanel from './components/OverviewPanel.vue';
import UiIcon from './components/UiIcon.vue';
import type { ViewMode } from './renderers/lightScene';
import './styles.css';
const store = useSceneStore(),
  { renderTargets, time } = useScene();
const mode = ref<ViewMode | 'overview'>('overview'),
  filter = ref('all'),
  scale = ref(1),
  offset = ref({ x: 0, y: 0 });
const tabs = [
  { id: 'overview', name: '总览', en: 'OVERVIEW' },
  { id: 'radar', name: '雷达探测', en: 'RADAR PPI' },
  { id: 'camera', name: '摄像头感知', en: 'CAMERA VIEW' },
  { id: 'risk', name: '风险场', en: 'RISK FIELD' },
] as const;
const filters = computed(() =>
  mode.value === 'camera'
    ? [
        ['all', '全部'],
        ['car', '车辆'],
        ['truck', '货车'],
        ['person', '行人'],
      ]
    : [
        ['all', '全部'],
        ['high', '高风险'],
        ['mid', '中风险'],
        ['low', '低风险'],
      ],
);
watch(mode, () => {
  filter.value = 'all';
});
const targets = computed(() =>
  store.frame.targets
    .filter((t) => {
      const v = t.risk?.value;
      if (mode.value === 'camera')
        return !!t.camera && (filter.value === 'all' || t.camera.class === filter.value);
      if(mode.value === 'radar' && !t.radar || mode.value === 'risk' && !t.fusion)return false;
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
function resize() {
  scale.value = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
  offset.value = {
    x: (window.innerWidth - 1920 * scale.value) / 2,
    y: (window.innerHeight - 1080 * scale.value) / 2,
  };
}
onMounted(() => {
  resize();
  window.addEventListener('resize', resize);
});
onUnmounted(() => window.removeEventListener('resize', resize));
</script>
<template>
  <main class="cockpit-viewport">
    <div
      class="cockpit-stage"
      :class="{ 'overview-stage': mode === 'overview' }"
      :style="{ transform: `translate(${offset.x}px,${offset.y}px) scale(${scale})` }"
    >
      <StatusBar />
      <div class="monitor-layout" :class="{ 'overview-layout': mode === 'overview' }">
        <TargetInspector v-if="mode !== 'overview'" />
        <section class="monitor-main glass-panel">
          <div class="monitor-toolbar">
            <div class="view-tabs" role="tablist" aria-label="感知视图">
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
                ><small>{{ tab.en }}</small>
              </button>
            </div>
            <div class="view-indicator">
              <i class="live-dot" /> {{ store.frame.source==='recording' ? '实测回放' : store.playing ? '实时感知' : '观测暂停' }}
              <template v-if="store.frame.replay">
                <input type="range" aria-label="实测回放进度" min="0" :max="store.frame.replay.durationMs" step="100" :value="store.frame.replay.positionMs" @change="store.seek(Number(($event.target as HTMLInputElement).value))" style="width:130px;accent-color:#008e8c" />
                <span>{{ (store.frame.replay.positionMs/1000).toFixed(1) }} / {{ (store.frame.replay.durationMs/1000).toFixed(1) }} s</span>
                <button aria-label="从头回放" @click="store.seek(0)">↺</button>
              </template>
            </div>
          </div>
          <OverviewPanel v-if="mode === 'overview'" :targets="renderTargets" :time="time" @open="mode = $event" />
          <div v-else class="monitor-content">
            <SceneViewport :mode="mode" :targets="renderTargets" :time="time" />
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
                      <span>连接状态<b>{{ store.frame.live.radar.state==='streaming' ? '实物雷达在线' : store.frame.live.radar.error==='EADDRNOTAVAIL' ? '雷达网卡未就绪' : store.frame.live.radar.state==='stale' ? '数据超时' : '连接中 / 断开' }}</b></span>
                      <span>设备地址<b>{{ store.frame.live.radar.endpoint }}</b></span>
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
                  <div class="sensor-stat">
                    <span>当前视觉目标</span
                    ><strong
                      >{{
                        String(store.frame.targets.filter((t) => t.camera).length).padStart(2, '0')
                      }}<small> OBJECTS</small></strong
                    >
                  </div>
                  <div class="sensor-details">
                    <span
                      >观测源<b>{{ store.frame.live ? '网络摄像头 · '+(store.frame.live.camera.state==='streaming'?'实时':'待连接') : store.frame.source==='recording' ? '实测录像' : store.videoSource.type.toUpperCase() }}</b></span
                    ><span
                      >{{ store.frame.source==='recording' ? '原始检测记录' : '融合目标' }}<b>{{
                        store.frame.recordingCounts?.detections ?? store.frame.targets.filter((t) => t.camera && t.radar).length
                      }}</b></span
                    ><span
                      >选中置信度<b>{{
                        store.selected?.camera
                          ? (store.selected.camera.confidence * 100).toFixed(1) + '%'
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
                    :aria-label="'选择目标 ' + target.id"
                    @click="store.select(target.id)"
                  >
                    <span class="target-row-icon"
                      ><UiIcon
                        :name="
                          mode === 'camera'
                            ? target.camera?.class === 'truck'
                              ? 'truck'
                              : target.camera?.class === 'person'
                                ? 'person'
                                : target.camera
                                  ? 'car'
                                  : 'radar'
                            : 'focus'
                        "
                        :size="24" /></span
                    ><span class="target-row-body"
                      ><b
                        >{{ target.id
                        }}<small>{{
                          !target.risk ? '未知' : target.risk.value >= 0.75
                            ? '高风险'
                            : (target.risk?.value ?? 0) >= 0.4
                              ? '中风险'
                              : '低风险'
                        }}</small></b
                      ><span
                        ><strong>{{ mode==='camera' && target.camera ? (target.camera.confidence*100).toFixed(1)+'%' : target.risk?.value.toFixed(2) ?? '—' }}</strong
                        ><small>{{
                          mode==='camera' ? target.camera?.class : target.autoAssociation ? '自动关联 · 待确认' : target.radar ? (target.camera ? '已融合' : '仅雷达') : '仅视觉'
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
      <footer class="system-footer">
        <span><i class="live-dot" />感知 · 融合 · 风险评估</span
        ><span
          >{{ store.frame.northCalibrated===false ? '传感器局部 XY · 北向待现场标定' : '本地 ENU · 正北 0°' }} <i />
          {{ store.frame.source==='recording' ? '历史实测 · 主机 UTC 对齐' : store.connection === 'mock' ? '模拟数据 · 10 Hz' : '实时接口数据' }}</span
        ><b>SENTINEL <em>/</em> MULTIMODAL INTELLIGENCE</b>
      </footer>
    </div>
  </main>
</template>
