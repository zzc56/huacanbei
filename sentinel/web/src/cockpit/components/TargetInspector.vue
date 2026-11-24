<script setup lang="ts">
import { computed } from 'vue';
import { useSceneStore } from '../stores/scene';
import { riskParams } from '../core/risk';
import RiskTrend from './RiskTrend.vue';
defineProps<{ bundledReplay?: boolean }>();
import UiIcon from './UiIcon.vue';
import { targetCategory, targetDisplayName } from '../core/targetLabels';
import { measurementStatus } from '../../core/measurementStatus';
const store = useSceneStore();
const risk = computed(() => store.selectedMeasurement?.risk?.value);
const riskTitle = computed(() => {
  if (store.frame.source === 'live') return '雷达估计场值';
  if (store.frame.source === 'recording') return '目标位置场值';
  return '综合风险值';
});
const displayedPosition = computed(() => store.selectedMeasurement?.fusion);
const displayedDistance = computed(() => store.selectedMeasurement?.radar?.range ??
  (displayedPosition.value ? Math.hypot(displayedPosition.value.x, displayedPosition.value.y) : undefined));
const level = computed(() => {
  if (risk.value === undefined) return '';
  if (risk.value >= riskParams.threshold) return '高风险';
  return risk.value >= 0.4 ? '中风险' : '低风险';
});
const type = computed(() => targetCategory(store.selected) ?? (store.selected ? '类别未识别' : '—'));
const selectedName = computed(() => targetDisplayName(store.selected));
const pairedVisualType = computed(() => {
  const target = store.selected;
  const category = target?.camera?.class;
  return target?.radar && category !== 'unknown' ? category : undefined;
});
const typeIcon = computed(() => {
  if (store.selected?.radar) return 'car';
  if (['car', 'truck', 'person'].includes(type.value)) return type.value;
  return 'camera';
});
const measurement=computed(()=>measurementStatus(store.selected));
const azimuthReference = computed(() => {
  if (!displayedPosition.value) return measurement.value.position;
  return store.frame.northCalibrated === true ? '正北 0° · 顺时针' : '传感器 +Y 为 0° · 顺时针';
});
const associations = computed(() => store.frame.targets.filter((target) =>
  store.frame.source === 'recording' ? target.autoAssociation : target.radar && target.camera,
).length);
const associationCount = computed(() => {
  if (store.frame.source === 'live' && store.frame.live?.association?.state !== 'active') return '—';
  if (store.frame.source === 'recording' && !associations.value &&
      store.frame.replayAssociation !== 'evaluated' && store.frame.replayAssociation !== 'offline-candidates') return '—';
  return associations.value;
});
const associationStatus = computed(() => {
  if (store.frame.source === 'live') return store.frame.live?.association?.message ?? '等待实时数据';
  if (store.frame.source !== 'recording') return '雷达 + 视觉';
  if (store.frame.replayAssociation === 'offline-candidates') return associations.value ? '本帧雷视关联' : '本帧无关联';
  if (associations.value) return '暂定轨迹关联';
  if (store.frame.replayAssociation === 'missing-calibration') return '缺少雷视标定';
  if (store.frame.replayAssociation === 'evaluated') return '本帧无匹配';
  return '未提供关联结果';
});
</script>
<template>
  <aside class="target-inspector glass-panel">
    <div class="section-heading inspector-title">
      <h2>当前选中目标</h2>
      <span class="corner-slashes">//</span>
    </div>
    <div class="target-lock" :title="measurement.detail">
      <span><UiIcon name="focus" :size="16" />{{ selectedName }}</span
      ><b><i class="live-dot" /><span class="target-source">{{ measurement.source }}</span></b>
    </div>
    <div class="risk-hero" :class="{ 'risk-empty': risk === undefined }">
      <div class="risk-title">
        <span>{{ riskTitle }}</span
        ><span
          class="risk-badge"
          :class="{ high: (risk ?? 0) >= 0.75, mid: (risk ?? 0) >= 0.4 && (risk ?? 0) < 0.75 }"
          >{{ level }}</span
        >
      </div>
      <div class="risk-number">
        <template v-if="risk !== undefined">{{ risk.toFixed(2) }}<span>/ 1.00</span></template>
      </div>
      <div class="risk-scale">
        <template v-if="risk !== undefined">
          <i :style="{ width: risk * 100 + '%' }" /><b :style="{ left: risk * 100 + '%' }" />
        </template>
      </div>
      <div class="risk-range">
        <span>低场值</span><span>风险阈值 {{ riskParams.threshold }}</span
        ><span>高风险</span>
      </div>
    </div>
    <div class="target-properties">
      <div>
        <span><UiIcon :name="typeIcon" :size="17" />目标类型</span>
        <strong class="type-text">{{ type }}</strong>
        <small>{{ pairedVisualType ? `视觉 ${pairedVisualType}` : '' }}</small>
      </div>
      <div>
        <span>坐标 (X, Y)</span
        ><strong>{{
          displayedPosition
            ? displayedPosition.x.toFixed(1) + ', ' + displayedPosition.y.toFixed(1)
            : ''
        }}</strong>
      </div>
      <div>
        <span>目标距离</span
        ><strong
          >{{
            displayedDistance?.toFixed(1)
          }}<small v-if="displayedDistance !== undefined"> m</small></strong
        >
      </div>
      <div>
        <span>方位角</span><strong>{{ displayedPosition ? `${displayedPosition.azimuth.toFixed(1)}°` : '' }}</strong
        ><small :title="store.frame.northCalibrated === false ? '原始记录未提供北向标定' : undefined">{{ azimuthReference }}</small>
      </div>
      <div>
        <span>径向速度</span
        ><strong
          >{{ displayedPosition?.radialVelocity?.toFixed(1) }}<small v-if="displayedPosition?.radialVelocity != null"> m/s</small></strong
        ><small :title="measurement.detail">{{ store.frame.source==='recording' ? measurement.velocity : '接近 − / 远离 +' }}</small>
      </div>
      <div>
        <span>切向速度</span
        ><strong
          >{{ displayedPosition?.tangentialVelocity?.toFixed(1)
          }}<small v-if="displayedPosition?.tangentialVelocity != null"> m/s</small></strong
        ><small :title="measurement.detail">{{ displayedPosition?.tangentialVelocity==null ? measurement.velocity : '顺时针为正' }}</small>
      </div>
    </div>
    <div class="inspector-metrics">
      <div>
        <span><UiIcon name="risk" :size="18" />告警数</span><strong>{{ store.alerts }}</strong
        ><small class="warm">风险 ≥ 0.75</small>
      </div>
      <div>
        <span><UiIcon name="pulse" :size="18" />平均风险</span
        ><strong>{{ store.averageRisk?.toFixed(2) ?? '—' }}</strong
        ><small>已知场值目标 {{ store.knownRiskTargets.length }}/{{ store.riskTargets.length }}</small>
      </div>
      <div>
        <span><UiIcon name="link" :size="18" />{{ store.frame.source==='live' ? '雷视关联' : store.frame.source==='recording' ? '自动关联' : '融合目标' }}</span
        ><strong>{{ associationCount }}</strong
        ><small>{{ associationStatus }}</small>
      </div>
    </div>
    <RiskTrend :target-name="selectedName" :bundled-replay="bundledReplay" />
    <div class="inspector-foot">
      <span :title="measurement.detail"><UiIcon name="link" :size="14" />跨视图同步锁定</span><b>{{ selectedName }}</b>
    </div>
  </aside>
</template>

<style scoped>
.target-lock > span { flex-shrink: 0; }
.target-lock > b { min-inline-size: 0; }
.target-lock .live-dot { flex-shrink: 0; }
.target-source {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.risk-badge { display: flex; align-items: center; white-space: nowrap; }
.risk-badge::before { content: ''; block-size: 1lh; }
.risk-empty .risk-badge { visibility: hidden; }
.risk-number { block-size: 1lh; white-space: nowrap; }
.target-properties > div > strong {
  block-size: 1lh;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.target-properties > div > small {
  display: -webkit-box;
  block-size: 2lh;
  overflow: hidden;
  white-space: normal;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}
.target-properties > div:first-child > small {
  block-size: 1lh;
  -webkit-line-clamp: 1;
}
</style>
