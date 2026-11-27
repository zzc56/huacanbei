<script setup lang="ts">
import { computed } from 'vue';
import type { DriveDirection, DriveSnapshot, VehicleDetectionMode } from '../../../../sentinel-backend/src/vehicle/contracts';
import UiIcon from './UiIcon.vue';

const props = defineProps<{ state:DriveSnapshot|null; direction:DriveDirection; locked:boolean; detectionMode:VehicleDetectionMode;
  fusionReady:boolean; stationaryFusion?:boolean }>();
const emit = defineEmits<{telemetry:[enabled:boolean]; radarTrial:[enabled:boolean]}>();
const requestText = {forward:'请求前进',stop:'请求停车'};
const bench = computed(() => props.state?.bench);
const measurement = computed(() => bench.value?.radarTrial?.measurement);
const telemetry = computed(() => props.state?.telemetry);
const decision = computed(() => {
  if (props.stationaryFusion) return '静止融合';
  const drive = bench.value;
  if (!drive) return telemetry.value?.status === 'online' ? '等待启用实车控制' : '实体小车未连接';
  if (drive.phase === 'arming') return '正在准备';
  if (drive.phase === 'stopped') return '实车驱动已停用';
  if (drive.radarTrial?.state === 'obstacle') return drive.detectionMode === 'fusion' ? '融合风险停车' : '雷达风险停车';
  if (drive.radarTrial?.state === 'release') return '保持停车';
  return drive.direction === 'forward' ? '前进' : '等待按键';
});
function speed(value?:number) { return value === undefined ? '—' : value.toFixed(2); }
function centimetres(metres: number) { return (metres * 100).toFixed(1) + ' cm'; }
const canArmRadar = computed(() => telemetry.value?.readyForRadarTrial === true &&
  (props.detectionMode === 'radar' || props.fusionReady));
const requestSpeed = computed(() => props.direction === 'stop' ? 0 : bench.value?.targetSpeedMps);
const radarBraking = computed(() => {
  return bench.value?.phase === 'stopped' || bench.value?.radarTrial?.state === 'obstacle';
});
const telemetryActive = computed(() => telemetry.value && ['connecting','online','stale'].includes(telemetry.value.status));
const telemetryText = {
  idle:'等待连接', connecting:'正在连接', online:'正在接收', stale:'反馈超时',
  error:'连接失败，请检查小车电源和手机蓝牙', busy:'另一个控制页正在读取串口',
};
</script>
<template>
  <section class="glass-panel driving-status" aria-label="驾驶状态">
    <header class="section-heading"><h2>驾驶状态</h2><UiIcon name="car"/></header>
    <div class="request"><span>我的指令</span><b>{{ requestText[direction] }}</b></div>
    <div class="decision" :class="{ stop: radarBraking }">
      <small>系统决定</small><strong>{{ decision }}</strong>
      <p v-if="stationaryFusion">方向键已停用，保持小车静止</p>
      <p v-else-if="locked">松开方向键后重新按下</p>
      <p v-else-if="bench">{{ bench.message }}</p>
      <p v-else-if="state && !telemetry">等待配置实车串口</p>
    </div>
    <dl>
      <div><dt>请求速度</dt><dd>{{ speed(requestSpeed) }} <small>m/s</small></dd></div>
      <div><dt>允许速度上限</dt><dd>{{ speed(stationaryFusion ? 0 : bench?.speedLimitMps ?? 0) }} <small>m/s</small></dd></div>
    </dl>
    <div v-if="bench" class="request">
      <span>测试目标速度</span><b>{{ speed(bench.targetSpeedMps) }} m/s</b>
    </div>
    <section v-if="telemetry" class="stock-feedback" aria-label="实车编码器">
      <header>
        <h3>实车编码器</h3>
        <button type="button" @click="emit('telemetry', !telemetryActive)">
          {{ telemetryActive ? '断开串口' : '连接 ' + telemetry.port }}
        </button>
      </header>
      <p class="telemetry-status" role="status">{{ telemetryText[telemetry.status] }} · {{ bench ? '最终测试' : '只读' }}</p>
      <p v-if="!telemetry.sample" class="telemetry-status">等待轮速反馈</p>
      <dl>
        <div><dt>A 路轮速</dt><dd>{{ speed(telemetry.sample?.wheelAMps) }} <small>m/s</small></dd></div>
        <div><dt>B 路轮速</dt><dd>{{ speed(telemetry.sample?.wheelBMps) }} <small>m/s</small></dd></div>
      </dl>
      <div class="request"><span>电量</span><b>{{ telemetry.sample?.batteryPercent == null ? '—' : telemetry.sample.batteryPercent + '%' }}</b></div>
      <template v-if="!bench">
        <button class="bench-button" :disabled="!canArmRadar || stationaryFusion" type="button" @click="emit('radarTrial', true)">启用最终测试</button>
        <p class="telemetry-status">{{ detectionMode === 'fusion' && !fusionReady
          ? '请设置行驶起点，并等待摄像头与雷达观测对齐。' : '适用于已验证车端超时停车的固件。' }}</p>
      </template>
    </section>
    <section v-if="bench?.radarTrial && detectionMode === 'radar'" class="stock-feedback" aria-label="雷达停车测距" aria-live="polite">
      <header><h3>雷达停车测距</h3></header>
      <p v-if="!measurement" class="telemetry-status">对准静止纸箱，自动停车或按空格后记录距离。</p>
      <p v-else-if="measurement.status === 'unavailable'" class="telemetry-status">{{ measurement.message }}</p>
      <template v-else>
        <div class="request"><span>停车前平均轮速</span><b>{{ speed(measurement.wheelSpeedMps) }} m/s</b></div>
        <div class="request"><span>发停车指令时</span><b>{{ centimetres(measurement.beforeM) }}</b></div>
        <p v-if="measurement.status === 'measuring'" class="telemetry-status">等待两路轮速归零和新雷达扫描</p>
        <template v-else>
          <div class="request"><span>停稳后</span><b>{{ centimetres(measurement.afterM) }}</b></div>
          <div class="request"><span>{{ measurement.reductionM < 0 ? '距离增加' : '距离减少' }}</span><b>{{ centimetres(Math.abs(measurement.reductionM)) }}</b></div>
        </template>
      </template>
    </section>
  </section>
</template>
<style scoped>
.driving-status{padding:clamp(14px,1.5vw,23px);color:#173e56}
header,.request{display:flex;justify-content:space-between;align-items:center}
header svg{color:#1e818c}.request{margin-top:10px;font-size:12px;color:#496d7f}
.request b{font-variant-numeric:tabular-nums;color:#154758}
.decision{margin:10px 0;padding:9px 14px;border-left:3px solid currentColor;border-radius:4px 10px 10px 4px;color:#08696e;background:linear-gradient(100deg,#d5efeb,transparent)}
.decision.stop{color:#a33e31;background:linear-gradient(100deg,#ffdfd7,transparent)}
.decision strong{display:block;font-size:clamp(24px,2.5vw,38px);line-height:1.2}
.decision p,.decision small,dt{font-size:12px}
dl{display:grid;grid-template-columns:1fr 1fr;margin:12px 0}
dl div+div{padding-left:13px;border-left:1px solid #bad6df}dt{color:#52707f}
dd{font:italic 700 clamp(20px,2vw,30px)/1.35 'Segoe UI',sans-serif;font-variant-numeric:tabular-nums}
dd small{font:12px 'Segoe UI',sans-serif}
.stock-feedback{border-top:1px solid #c3dce3;margin-top:14px;padding-top:10px}
.stock-feedback button{border:1px solid #9cc3cd;border-radius:5px;padding:4px 9px;font-size:12px}
.stock-feedback h3{font-size:14px}.stock-feedback dl{margin:7px 0 0}
.stock-feedback .bench-button{width:100%;margin-top:9px;padding:7px;color:#125d68;background:#d6efed}
.stock-feedback .bench-button:disabled{opacity:.55;cursor:default}
.telemetry-status{margin-top:4px;color:#496d7f;font-size:12px}
</style>
