<script setup lang="ts">
import { computed } from 'vue';
import { useSceneStore } from '../stores/scene';
import { riskParams } from '../core/risk';
import RiskTrend from './RiskTrend.vue';
import UiIcon from './UiIcon.vue';
import { measurementStatus } from '../../core/measurementStatus';
const store = useSceneStore();
const risk = computed(() => store.selected?.risk?.value);
const level = computed(() =>
  risk.value === undefined
    ? '风险未知'
    : risk.value >= riskParams.threshold
      ? '高风险'
      : risk.value >= 0.4
        ? '中风险'
        : '低风险',
);
const type = computed(
  () =>
    ({ car: '车辆', truck: '货车', person: '行人', pedestrian: '行人', bicycle: '骑行者', motorcycle:'摩托车', bus:'客车' })[
      store.selected?.camera?.class || store.selected?.kind || ''
    ] || '未知目标',
);
const measurement=computed(()=>measurementStatus(store.selected));
</script>
<template>
  <aside class="target-inspector glass-panel">
    <div class="section-heading inspector-title">
      <h2>当前选中目标</h2>
      <span class="corner-slashes">//</span>
    </div>
    <div class="target-lock" :title="measurement.detail">
      <span><UiIcon name="focus" :size="16" />{{ store.selectedId }}</span
      ><b><i class="live-dot" />{{ measurement.source }}</b>
    </div>
    <div class="risk-hero">
      <div class="risk-title">
        <span>{{ store.frame.source==='live' ? '雷达估计场值' : store.frame.source==='recording' ? '目标位置场值' : '综合风险值' }}</span
        ><span
          class="risk-badge"
          :class="{ high: (risk ?? 0) >= 0.75, mid: (risk ?? 0) >= 0.4 && (risk ?? 0) < 0.75 }"
          >{{ level }}</span
        >
      </div>
      <div class="risk-number">{{ risk?.toFixed(2) ?? '—' }}<span>/ 1.00</span></div>
      <div class="risk-scale">
        <i :style="{ width: (risk ?? 0) * 100 + '%' }" /><b
          :style="{ left: (risk ?? 0) * 100 + '%' }"
        />
      </div>
      <div class="risk-range">
        <span>低场值</span><span>风险阈值 {{ riskParams.threshold }}</span
        ><span>高风险</span>
      </div>
    </div>
    <div class="target-properties">
      <div>
        <span
          ><UiIcon
            :name="
              store.selected?.camera?.class === 'truck'
                ? 'truck'
                : store.selected?.camera?.class === 'person'
                  ? 'person'
                  : 'car'
            "
            :size="17"
          />目标类型</span
        ><strong class="type-text">{{ type }}</strong>
      </div>
      <div>
        <span>坐标 (X, Y)</span
        ><strong>{{
          store.selected?.fusion
            ? store.selected.fusion.x.toFixed(1) + ', ' + store.selected.fusion.y.toFixed(1)
            : '—'
        }}</strong>
      </div>
      <div>
        <span>目标距离</span
        ><strong
          >{{
            store.selected?.fusion
              ? Math.hypot(store.selected.fusion.x, store.selected.fusion.y).toFixed(1)
              : '—'
          }}<small> m</small></strong
        >
      </div>
      <div>
        <span>方位角</span><strong>{{ store.selected?.fusion?.azimuth.toFixed(1) ?? '—' }}°</strong
        ><small>{{ !store.selected?.fusion ? measurement.position : store.frame.northCalibrated===false ? '传感器 +Y · 北向待标定' : '正北 0° · 顺时针' }}</small>
      </div>
      <div>
        <span>径向速度</span
        ><strong
          >{{ store.selected?.fusion?.radialVelocity?.toFixed(1) ?? '—' }}<small> m/s</small></strong
        ><small :title="measurement.detail">{{ store.frame.source==='recording' ? measurement.velocity : '接近 − / 远离 +' }}</small>
      </div>
      <div>
        <span>切向速度</span
        ><strong
          >{{ store.selected?.fusion?.tangentialVelocity?.toFixed(1) ?? '—'
          }}<small> m/s</small></strong
        ><small :title="measurement.detail">{{ store.selected?.fusion?.tangentialVelocity==null ? measurement.velocity : '顺时针为正' }}</small>
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
        ><small>已知场值目标 {{ store.knownRiskTargets.length }}/{{ store.frame.targets.length }}</small>
      </div>
      <div>
        <span><UiIcon name="link" :size="18" />{{ store.frame.source==='recording' ? '自动关联' : '融合目标' }}</span
        ><strong>{{ store.frame.targets.filter((t) => store.frame.source==='recording' ? t.autoAssociation : t.radar && t.camera).length }}</strong
        ><small>{{ store.frame.source==='recording' ? '算法候选 · 待确认' : '雷达 + 视觉' }}</small>
      </div>
    </div>
    <RiskTrend />
    <div class="inspector-foot">
      <span :title="measurement.detail"><UiIcon name="link" :size="14" />{{ store.selected?.autoAssociation ? '关联评分 '+store.selected.autoAssociation.score.toFixed(2)+' · 待确认' : '跨视图同步锁定' }}</span><b>{{ store.selectedId }}</b>
    </div>
  </aside>
</template>
