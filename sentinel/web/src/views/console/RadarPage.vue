<template>
  <div class="radar-page">
    <!-- 连接卡（白底，2 行 8 列栅格） -->
    <CardPanel dense>
      <div class="conn-grid">
        <!-- 行 1 -->
        <FieldLabel class="col-span-1">雷达地址</FieldLabel>
        <div class="col-span-2">
          <AppInput
            v-model="radarStore.host"
            :disabled="radarStore.inputsDisabled"
            aria-label="雷达地址"
          />
        </div>
        <FieldLabel class="col-span-1">端口</FieldLabel>
        <div class="col-span-1">
          <AppInput
            v-model="radarStore.port"
            type="number"
            :min="1"
            :max="65535"
            :disabled="radarStore.inputsDisabled"
            aria-label="雷达端口"
          />
        </div>
        <div class="col-span-2 btn-pair">
          <AppButton
            variant="primary"
            :disabled="!radarStore.canConnect"
            @click="radarStore.connect()"
          >
            连接
          </AppButton>
          <AppButton
            variant="danger"
            :disabled="!radarStore.canDisconnect"
            @click="radarStore.disconnect()"
          >
            断开
          </AppButton>
        </div>
        <div class="col-span-1 vendor-tag">TCR300-Self</div>

        <!-- 行 2 -->
        <FieldLabel class="col-span-1">保存目录</FieldLabel>
        <div class="col-span-5">
          <AppInput
            v-model="radarStore.saveDir"
            :readonly="radarStore.status.recording"
            :disabled="radarStore.status.recording"
            aria-label="保存目录"
          />
        </div>
        <div class="col-span-2">
          <AppButton
            :disabled="radarStore.status.recording"
            @click="chooseDirectory"
          >
            选择目录…
          </AppButton>
        </div>
      </div>
    </CardPanel>

    <!-- 动作条 -->
    <CardPanel dense>
      <div class="action-bar">
        <AppButton
          variant="primary"
          :disabled="!radarStore.status.connected || radarStore.status.recording"
          @click="radarStore.startRecording()"
        >
          开始保存
        </AppButton>
        <AppButton
          :disabled="!radarStore.status.recording"
          @click="radarStore.stopRecording()"
        >
          停止保存
        </AppButton>
        <AppButton @click="openSessionFolder">
          打开实验文件夹
        </AppButton>
        <AppButton
          :disabled="radarStore.status.connected || radarStore.status.state === 'Replay'"
          @click="radarStore.startReplay(false)"
        >
          回放采集目录…
        </AppButton>
        <AppButton
          :disabled="radarStore.status.state !== 'Replay'"
          @click="radarStore.stopReplay()"
        >
          停止回放
        </AppButton>
        <AppButton @click="showParamsModal = true">
          雷达参数…
        </AppButton>
      </div>
    </CardPanel>

    <!-- 主内容（左 55% / 右 45%） -->
    <div class="main-split">
      <!-- 左侧散点位置视图 -->
      <CardPanel class="left-col">
        <template #header>
          <div class="plot-toolbar">
            <span class="toolbar-title">位置视图</span>
            <span class="toolbar-sep">|</span>
            <FieldLabel>X ±</FieldLabel>
            <div class="range-input">
              <AppInput
                v-model="radarStore.viewHalfWidth"
                type="number"
                compact
                :min="5"
                :max="200"
                aria-label="X横向范围"
              />
            </div>
            <span class="toolbar-sep">|</span>
            <FieldLabel>Y 0～</FieldLabel>
            <div class="range-input">
              <AppInput
                v-model="radarStore.viewLength"
                type="number"
                compact
                :min="10"
                :max="1000"
                aria-label="Y纵向范围"
              />
            </div>
            <span class="unit-label">m</span>
            <AppButton
              compact
              variant="ghost"
              :title="COPY.TOOLTIP_RESET_VIEW"
              @click="scatterRef?.resetView()"
            >
              恢复视图
            </AppButton>
          </div>
        </template>
        <div class="scatter-holder">
          <RadarScatterPlot
            ref="scatterRef"
            :targets="radarStore.targets"
            :half-width="radarStore.viewHalfWidth"
            :max-length="radarStore.viewLength"
          />
        </div>
      </CardPanel>

      <!-- 右侧目标事件表 + 运行日志 -->
      <CardPanel class="right-col" :title="COPY.TARGET_TABLE_TITLE">
        <div class="table-container" :title="COPY.TOOLTIP_TARGET_COL">
          <table class="target-table">
            <thead>
              <tr>
                <th>ID</th>
                <th class="num">X(m)</th>
                <th class="num">Y(m)</th>
                <th class="num">Vx(m/s)</th>
                <th class="num">Vy(m/s)</th>
                <th class="num">类别值</th>
                <th>电脑接收时间</th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="radarStore.targets.length === 0">
                <td colspan="7" class="empty-row">尚无目标事件（连接或启动回放后实时刷新）</td>
              </tr>
              <tr v-for="t in radarStore.targets" :key="t.id">
                <td class="tabular-nums">{{ t.id }}</td>
                <td class="num tabular-nums">{{ formatNum(t.x) }}</td>
                <td class="num tabular-nums">{{ formatNum(t.y) }}</td>
                <td class="num tabular-nums">{{ formatNum(t.vx) }}</td>
                <td class="num tabular-nums">{{ formatNum(t.vy) }}</td>
                <td class="num tabular-nums">{{ t.cls }}</td>
                <td class="tabular-nums">{{ t.vendorTime }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="log-section">
          <div class="log-header">
            <FieldLabel>运行日志</FieldLabel>
            <span class="log-cap">上限 24,000 字符自动截断保留最近 12,000 字符</span>
          </div>
          <textarea
            class="log-textarea"
            readonly
            :value="radarStore.logText"
            aria-label="运行日志"
          />
        </div>
      </CardPanel>
    </div>

    <!-- 状态条 -->
    <StatusBar :status="radarStore.status" />

    <!-- 页脚灰字 -->
    <p class="page-footnote">{{ COPY.RADAR_FOOTER }}</p>

    <!-- 雷达参数只读弹窗 -->
    <div v-if="showParamsModal" class="modal-backdrop" @click.self="showParamsModal = false">
      <div class="modal-card" role="dialog" aria-label="雷达参数只读预览">
        <header class="modal-header">
          <h3>雷达参数（只读展示 · 未经真实硬件写入验收）</h3>
          <AppButton compact variant="ghost" @click="showParamsModal = false">关闭</AppButton>
        </header>
        <div class="modal-body">
          <p class="modal-note">
            当前版本仅提供 TCR300 雷达寄存器参数只读快照，写入接口尚未经过实测硬件闭环验证。
          </p>
          <div class="param-grid">
            <div class="param-item"><span>工作频段：</span><strong>77 GHz FMCW</strong></div>
            <div class="param-item"><span>最大探测距离：</span><strong>120.0 m</strong></div>
            <div class="param-item"><span>速度测量范围：</span><strong>±35.0 m/s</strong></div>
            <div class="param-item"><span>角度视野 (FOV)：</span><strong>±45°</strong></div>
            <div class="param-item"><span>上报周期：</span><strong>100 ms (10 Hz)</strong></div>
            <div class="param-item"><span>硬件时间戳同步：</span><strong>待实测确认（当前使用主机 UTC）</strong></div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { COPY } from '@/types';
import { useRadarStore } from '@/stores/radar';
import { useAppStore } from '@/stores/app';
import { formatNum } from '@/utils/format';
import CardPanel from '@/components/ui/CardPanel.vue';
import FieldLabel from '@/components/ui/FieldLabel.vue';
import AppInput from '@/components/ui/AppInput.vue';
import AppButton from '@/components/ui/AppButton.vue';
import RadarScatterPlot from '@/components/charts/RadarScatterPlot.vue';
import StatusBar from '@/components/layout/StatusBar.vue';

const radarStore = useRadarStore();
const appStore = useAppStore();
const showParamsModal = ref(false);
const scatterRef = ref<InstanceType<typeof RadarScatterPlot> | null>(null);

onMounted(() => {
  radarStore.init();
});

function chooseDirectory(): void {
  const nextDir = radarStore.saveDir === '/data' ? '/data/exp_road_20261016' : '/data';
  radarStore.saveDir = nextDir;
  radarStore.appendLog(`已切换保存目录为 ${nextDir}`);
}

function openSessionFolder(): void {
  const dir = radarStore.status.sessionDirectory || radarStore.saveDir;
  appStore.showToast(`实验目录路径：${dir}`);
}
</script>

<style scoped>
.radar-page {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}

.conn-grid {
  display: grid;
  grid-template-columns: 80px 1fr 1fr 60px 110px 1fr 1fr 120px;
  gap: var(--sp-2);
  align-items: center;
}

.col-span-1 { grid-column: span 1; }
.col-span-2 { grid-column: span 2; }
.col-span-5 { grid-column: span 5; }

.btn-pair {
  display: flex;
  gap: var(--sp-2);
}

.vendor-tag {
  text-align: right;
  font-size: var(--fs-cap);
  color: var(--c-ink-2);
  font-family: var(--font-mono);
}

.action-bar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--sp-2);
}

.main-split {
  display: grid;
  grid-template-columns: 55fr 45fr;
  gap: var(--sp-3);
  min-height: 480px;
}

.left-col,
.right-col {
  display: flex;
  flex-direction: column;
}

.plot-toolbar {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  width: 100%;
}

.toolbar-title {
  font-size: var(--fs-cap);
  font-weight: 700;
  color: var(--c-ink);
}

.toolbar-sep {
  color: var(--c-border-strong);
}

.range-input {
  width: 68px;
}

.unit-label {
  font-size: var(--fs-cap);
  color: var(--c-ink-2);
}

.scatter-holder {
  height: 440px;
}

.table-container {
  height: 250px;
  overflow-y: auto;
  border: 1px solid var(--c-border);
  border-radius: var(--r-sm);
}

.target-table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--fs-cap);
}

.target-table thead th {
  position: sticky;
  top: 0;
  background: var(--c-head);
  color: var(--c-ink);
  font-weight: 600;
  height: 27px;
  padding: 0 var(--sp-2);
  text-align: left;
  border-bottom: 1px solid var(--c-border-strong);
}

.target-table th.num,
.target-table td.num {
  text-align: right;
}

.target-table tbody tr {
  height: 27px;
  border-bottom: 1px solid var(--c-head);
}

.target-table tbody tr:nth-child(even) {
  background: var(--c-row-alt);
}

.target-table tbody tr:hover {
  background: var(--c-head);
}

.target-table td {
  padding: 0 var(--sp-2);
}

.empty-row {
  text-align: center;
  color: var(--c-ink-2);
  padding: var(--sp-4) 0;
}

.log-section {
  margin-top: var(--sp-2);
  display: flex;
  flex-direction: column;
  gap: var(--sp-1);
}

.log-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.log-cap {
  font-size: var(--fs-xs);
  color: var(--c-ink-2);
}

.log-textarea {
  width: 100%;
  height: 155px;
  resize: none;
  padding: var(--sp-2);
  background: var(--c-surface-alt);
  border: 1px solid var(--c-border);
  border-radius: var(--r-sm);
  font-family: var(--font-mono);
  font-size: var(--fs-xs);
  color: var(--c-ink);
  line-height: 1.45;
}

.page-footnote {
  font-size: var(--fs-cap);
  color: var(--c-ink-2);
  padding: 2px var(--sp-1);
}

.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(17, 28, 44, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 80;
}

.modal-card {
  width: 520px;
  background: var(--c-surface);
  border-radius: var(--r-md);
  box-shadow: var(--shadow-elevated);
  border: 1px solid var(--c-border);
  padding: var(--sp-4);
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--sp-3);
}

.modal-header h3 {
  font-size: var(--fs-body);
  font-weight: 700;
}

.modal-note {
  font-size: var(--fs-cap);
  color: var(--c-warn-ink);
  background: var(--c-warn-soft);
  padding: var(--sp-2);
  border-radius: var(--r-sm);
  margin-bottom: var(--sp-3);
}

.param-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--sp-2);
  font-size: var(--fs-cap);
}

.param-item {
  padding: var(--sp-2);
  background: var(--c-surface-alt);
  border-radius: var(--r-sm);
}
</style>
