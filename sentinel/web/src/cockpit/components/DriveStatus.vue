<script setup lang="ts">
import { computed } from 'vue';
import type { DriveDirection, DriveSnapshot } from '../../../../sentinel-backend/src/vehicle/contracts';
import UiIcon from './UiIcon.vue';

const props = defineProps<{ state:DriveSnapshot|null; direction:DriveDirection; locked:boolean }>();
const requestText = {forward:'请求前进',reverse:'请求后退',stop:'请求停车'};
const decision = computed(() => {
  const state = props.state;
  if (!state) return '等待连接';
  if (state.timedOut) return '指令超时停车';
  if (state.direction === 'reverse') return '低速后退';
  if (state.direction === 'stop') return '已停车';
  return {stop:'自动停车',slow:'自动减速',cruise:'允许前进'}[state.frame.motion.action];
});
const distance = computed(() => props.state?.frame.closestForwardM);
function speed(value?:number) { return value === undefined ? '—' : value.toFixed(2); }
</script>
<template>
  <section class="glass-panel driving-status" aria-label="驾驶状态">
    <header class="section-heading"><h2>驾驶状态</h2><UiIcon name="car"/></header>
    <div class="request"><span>我的指令</span><b>{{ requestText[direction] }}</b></div>
    <div class="decision" :class="state?.direction==='forward' ? state.frame.motion.action : ''">
      <small>系统决定</small><strong>{{ decision }}</strong>
      <p v-if="locked">松开方向键后重新按下</p>
      <p v-else-if="state?.direction==='reverse'">当前风险场只评估车前方</p>
      <p v-else-if="distance!=null">前方障碍约 {{ distance.toFixed(2) }} 米</p>
      <p v-else>{{ state ? '前方通道内暂无观测目标' : '等待模拟小车连接' }}</p>
    </div>
    <dl>
      <div><dt>请求速度</dt><dd>{{ speed(state?.requestedMps) }} <small>m/s</small></dd></div>
      <div><dt>允许速度上限</dt><dd>{{ speed(state?.limitMps) }} <small>m/s</small></dd></div>
    </dl>
    <div class="feedback"><span>速度反馈 · 模拟速度</span>
      <strong data-speed>{{ speed(state?.speedMps) }} <small>m/s</small></strong></div>
    <div class="request"><span>模拟位移</span><b data-travel>{{ state?.travelM.toFixed(3) ?? '—' }} m</b></div>
    <div class="request"><span>实体编码器</span><span>等待反馈</span></div>
  </section>
</template>
<style scoped>
.driving-status{padding:clamp(14px,1.5vw,23px);color:#173e56}
header,.request,.feedback{display:flex;justify-content:space-between;align-items:center}
header svg{color:#1e818c}.request{margin-top:10px;font-size:12px;color:#496d7f}
.request b{font-variant-numeric:tabular-nums;color:#154758}
.decision{margin:10px 0;padding:9px 14px;border-left:3px solid currentColor;border-radius:4px 10px 10px 4px;color:#08696e;background:linear-gradient(100deg,#d5efeb,transparent)}
.decision.slow{color:#805a14;background:linear-gradient(100deg,#ffefc9,transparent)}
.decision.stop{color:#a33e31;background:linear-gradient(100deg,#ffdfd7,transparent)}
.decision strong{display:block;font-size:clamp(24px,2.5vw,38px);line-height:1.2}
.decision p,.decision small,dt,.feedback span{font-size:12px}
dl{display:grid;grid-template-columns:1fr 1fr;margin:12px 0}
dl div+div{padding-left:13px;border-left:1px solid #bad6df}dt{color:#52707f}
dd,.feedback strong{font:italic 700 clamp(20px,2vw,30px)/1.35 'Segoe UI',sans-serif;font-variant-numeric:tabular-nums}
dd small,.feedback small{font:12px 'Segoe UI',sans-serif}.feedback{border-block:1px solid #c3dce3;padding:7px 0;color:#126e74}
</style>
