<template>
  <div class="fusion-page">
    <!-- 1. 标题 -->
    <div class="section-heading-row">
      <span class="section-heading">{{ COPY.FUSION_TITLE }}</span>
      <div class="demo-state-pills" role="group" aria-label="答辩质量态快捷切换">
        <span class="pill-label">答辩状态演示：</span>
        <button
          type="button"
          class="state-pill"
          :class="{ active: currentDemoMode === 'ok' }"
          @click="switchDemo('ok')"
        >
          ok (全绿正常)
        </button>
        <button
          type="button"
          class="state-pill"
          :class="{ active: currentDemoMode === 'expired' }"
          @click="switchDemo('expired')"
        >
          expired (超时隐藏)
        </button>
        <button
          type="button"
          class="state-pill"
          :class="{ active: currentDemoMode === 'uncalibrated' }"
          @click="switchDemo('uncalibrated')"
        >
          uncalibrated (未标定)
        </button>
      </div>
    </div>

    <!-- 2. 动作条 -->
    <CardPanel dense>
      <div class="action-bar">
        <AppButton compact @click="router.push('/console/radar')">雷达采集页</AppButton>
        <AppButton compact @click="router.push('/console/vision')">人车视觉页</AppButton>
        <span class="divider">|</span>
        <AppButton compact variant="primary" @click="showCalibModal = true">冻结画面标定</AppButton>
        <AppButton compact @click="importCalibration">导入标定</AppButton>
        <AppButton compact @click="exportCalibration">导出标定</AppButton>
        <AppButton compact variant="danger" @click="fusionStore.clearCalibration()">清除标定</AppButton>
        <AppButton compact @click="runSyntheticDemo">合成界面演示</AppButton>
        <span class="divider">|</span>
        <AppCheckbox
          v-model="fusionStore.extendRadarField"
          :title="COPY.TOOLTIP_EXTEND_RADAR"
          @change="fusionStore.applyParams()"
        >
          显示标定区外车辆风险场
        </AppCheckbox>
      </div>
    </CardPanel>

    <!-- 3. 参数条 -->
    <CardPanel dense>
      <div class="param-bar">
        <FieldLabel>X ±</FieldLabel>
        <div class="num-sm">
          <AppInput
            v-model="fusionStore.xHalfWidth"
            type="number"
            compact
            :min="5"
            :max="100"
            @change="fusionStore.applyParams()"
          />
        </div>
        <FieldLabel>Y 0～</FieldLabel>
        <div class="num-sm">
          <AppInput
            v-model="fusionStore.yMax"
            type="number"
            compact
            :min="10"
            :max="200"
            @change="fusionStore.applyParams()"
          />
        </div>
        <span class="unit-text">m</span>
        <span class="divider">|</span>
        <FieldLabel>对齐容差</FieldLabel>
        <div class="num-md">
          <AppInput
            v-model="fusionStore.alignWindowMs"
            type="number"
            compact
            :min="10"
            :max="2000"
            @change="fusionStore.applyParams()"
          />
        </div>
        <span class="unit-text">ms</span>
        <span class="divider">|</span>
        <FieldLabel>摄像头时间偏移</FieldLabel>
        <div class="num-md">
          <AppInput
            v-model="fusionStore.cameraOffsetMs"
            type="number"
            compact
            :min="-5000"
            :max="5000"
            @change="fusionStore.applyParams()"
          />
        </div>
        <span class="unit-text">ms（正值：视觉时刻后移；人工调整，非硬同步）</span>
      </div>
    </CardPanel>

    <!-- 4. 保存条 -->
    <CardPanel dense>
      <div class="save-bar">
        <FieldLabel>保存目录</FieldLabel>
        <div class="save-input">
          <AppInput
            v-model="fusionStore.saveDir"
            compact
            :readonly="fusionStore.recording"
            aria-label="融合保存目录"
          />
        </div>
        <AppButton compact :disabled="fusionStore.recording" @click="chooseSaveDir">选择目录…</AppButton>
        <AppButton
          compact
          variant="primary"
          :disabled="fusionStore.recording"
          @click="fusionStore.startRecording()"
        >
          保存融合结果
        </AppButton>
        <AppButton
          compact
          :disabled="!fusionStore.recording"
          @click="fusionStore.stopRecording()"
        >
          停止保存
        </AppButton>
        <AppButton compact @click="openFusionFolder">打开文件夹</AppButton>
        <AppButton compact @click="openCsvExportModal">导出研究 CSV…</AppButton>
      </div>
    </CardPanel>

    <!-- 5. 主区（左 52% / 右 48%） -->
    <div class="fusion-split">
      <CardPanel class="left-pane" title="完整视觉画面（保留比例，不裁剪）">
        <div class="pane-body">
          <VideoOverlay
            :frame="visionStore.currentFrame"
            :boxes="visionStore.visibleBoxes"
          />
        </div>
      </CardPanel>

      <CardPanel class="right-pane">
        <template #header>
          <div class="topview-header">
            <span class="topview-title">俯视图 · 标定区内融合行人 / 区外仅车辆场</span>
            <div class="topview-actions">
              <AppButton
                compact
                @click="fusionStore.showCalibrationBoundary = !fusionStore.showCalibrationBoundary"
              >
                {{ fusionStore.showCalibrationBoundary ? '隐藏标定框' : '显示标定框' }}
              </AppButton>
              <AppButton
                compact
                :title="COPY.TOOLTIP_RESET_VIEW"
                @click="topViewRef?.resetView()"
              >
                恢复视图
              </AppButton>
            </div>
          </div>
        </template>
        <div class="pane-body">
          <FusionTopView
            ref="topViewRef"
            :snapshot="fusionStore.snapshot"
            :show-calibration-boundary="fusionStore.showCalibrationBoundary"
          />
        </div>
      </CardPanel>
    </div>

    <!-- 6. 质量状态卡（白底 5 行） -->
    <CardPanel dense>
      <div class="quality-rows">
        <div class="q-row tabular-nums">{{ summaryLine }}</div>
        <div class="q-row quality-gate">{{ qualityGateLine }}</div>
        <div class="q-row">
          <span>{{ fusionStore.recording ? '融合保存：进行中' : COPY.FUSION_SAVE_EMPTY }}</span>
          <span class="q-sep">｜</span>
          <span>提示：{{ fusionStore.hintMessage }}</span>
        </div>
        <div class="q-row mono">
          {{ fusionStore.sessionDirectory ? `实验文件夹：${fusionStore.sessionDirectory}` : COPY.SESSION_DIR_EMPTY }}
        </div>
        <div class="q-row tabular-nums">{{ computeLine }}</div>
      </div>
    </CardPanel>

    <!-- 7. 页脚 -->
    <p class="page-footnote">{{ COPY.FUSION_FOOTER }}</p>

    <!-- 8. 导出研究 CSV 模态框 -->
    <div v-if="showCsvModal" class="modal-backdrop" @click.self="showCsvModal = false">
      <div class="modal-card" role="dialog" aria-label="导出研究 CSV">
        <header class="modal-header">
          <h3>导出研究 CSV</h3>
          <AppButton compact variant="ghost" @click="showCsvModal = false">关闭</AppButton>
        </header>
        <div class="modal-body">
          <FieldLabel>选择历史融合会话目录：</FieldLabel>
          <div class="session-list">
            <label
              v-for="s in historySessions"
              :key="s.dir"
              class="session-option"
              :class="{ selected: selectedExportSession === s.dir }"
            >
              <input
                v-model="selectedExportSession"
                type="radio"
                name="exportSession"
                :value="s.dir"
              />
              <div>
                <div class="s-dir">{{ s.dir }}</div>
                <div class="s-meta">{{ s.meta }}</div>
              </div>
            </label>
          </div>

          <div class="progress-wrap">
            <div class="progress-bar" :style="{ width: `${exportProgress}%` }" />
          </div>

          <div v-if="exportDone" class="export-result">
            <p><strong>导出完成！</strong> 输出目录：<code>{{ selectedExportSession }}/csv_export</code></p>
            <ul class="table-list">
              <li><code>snapshots.csv</code> — 帧级质量门控、时延差与网格统计</li>
              <li><code>objects.csv</code> — 雷达目标与地面投影行人米制状态</li>
              <li><code>interactions.csv</code> — 人车接近关系对（TTC、最近距离、相对风险值）</li>
            </ul>
          </div>

          <div class="modal-actions">
            <AppButton variant="primary" @click="runCsvExport">开始导出三张研究表</AppButton>
          </div>
        </div>
      </div>
    </div>

    <!-- 冻结画面标定模态框 -->
    <div v-if="showCalibModal" class="modal-backdrop" @click.self="showCalibModal = false">
      <div class="modal-card" role="dialog" aria-label="地面单应性标定">
        <header class="modal-header">
          <h3>冻结画面标定（4 点地面米制单应映射）</h3>
          <AppButton compact variant="ghost" @click="showCalibModal = false">关闭</AppButton>
        </header>
        <div class="modal-body">
          <p class="calib-desc">
            请在冻结图像中核对 4 个地面控制点的归一化像素坐标与实测地面米制坐标 (X 横向, Y 纵向)：
          </p>
          <table class="calib-table">
            <thead>
              <tr>
                <th>控制点</th>
                <th>图像 X (0-1)</th>
                <th>图像 Y (0-1)</th>
                <th>地面 X (m)</th>
                <th>地面 Y (m)</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(pt, idx) in calibDraft" :key="idx">
                <td>P{{ idx + 1 }}</td>
                <td><AppInput v-model="pt.imageX" type="number" compact :step="0.01" /></td>
                <td><AppInput v-model="pt.imageY" type="number" compact :step="0.01" /></td>
                <td><AppInput v-model="pt.groundX" type="number" compact :step="0.5" /></td>
                <td><AppInput v-model="pt.groundY" type="number" compact :step="0.5" /></td>
              </tr>
            </tbody>
          </table>
          <div class="modal-actions">
            <AppButton variant="primary" @click="confirmCalibration">应用标定</AppButton>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { COPY, type CalibrationPoint } from '@/types';
import { useFusionStore } from '@/stores/fusion';
import { useVisionStore } from '@/stores/vision';
import { useRadarStore } from '@/stores/radar';
import { useAppStore } from '@/stores/app';
import { DEFAULT_CALIBRATION_POINTS } from '@/utils/calibration';
import type { FusionDemoMode } from '@/data/mock/fusionSim';
import CardPanel from '@/components/ui/CardPanel.vue';
import FieldLabel from '@/components/ui/FieldLabel.vue';
import AppInput from '@/components/ui/AppInput.vue';
import AppButton from '@/components/ui/AppButton.vue';
import AppCheckbox from '@/components/ui/AppCheckbox.vue';
import VideoOverlay from '@/components/charts/VideoOverlay.vue';
import FusionTopView from '@/components/charts/FusionTopView.vue';

const route = useRoute();
const router = useRouter();
const fusionStore = useFusionStore();
const visionStore = useVisionStore();
const radarStore = useRadarStore();
const appStore = useAppStore();

const topViewRef = ref<InstanceType<typeof FusionTopView> | null>(null);
const currentDemoMode = ref<FusionDemoMode>('ok');

const showCsvModal = ref(false);
const exportProgress = ref(0);
const exportDone = ref(false);
const historySessions = [
  { dir: '/data/fusion/fusion_session_2026-10-13_15-20-11', meta: '240 快照 · 12 车辆 · 4 行人（已标定）' },
  { dir: '/data/fusion/fusion_session_2026-10-12_10-05-44', meta: '185 快照 · 9 车辆 · 3 行人（已标定）' },
  { dir: '/data/fusion/fusion_session_2026-10-11_18-42-09', meta: '310 快照 · 仅雷达车辆场（未标定对照）' }
];
const selectedExportSession = ref(historySessions[0].dir);

const showCalibModal = ref(false);
const calibDraft = ref<CalibrationPoint[]>(
  DEFAULT_CALIBRATION_POINTS.map((p) => ({ ...p }))
);

function switchDemo(mode: FusionDemoMode): void {
  currentDemoMode.value = mode;
  fusionStore.setDemoState(mode);
}

watch(
  () => route.query.demo,
  (val) => {
    if (val === 'ok' || val === 'expired' || val === 'uncalibrated') {
      switchDemo(val);
    }
  },
  { immediate: true }
);

onMounted(() => {
  fusionStore.init();
  visionStore.init();
  radarStore.init();
  if (!visionStore.currentFrame) {
    visionStore.loadOfflineExample();
  }
});

const summaryLine = computed(() => {
  const s = fusionStore.snapshot;
  if (!s) {
    return '雷达目标：0  投影行人：0  接近关系：0  时间差：—  风险场：不可用';
  }
  const timeDiffText = s.timeDifferenceMs !== null ? `${s.timeDifferenceMs} ms` : '—';
  let peakPart = '风险场：不可用';
  if (s.fieldAvailable && s.displayField !== null) {
    if (s.config.fieldScope === 'radar_only') {
      peakPart = `仅雷达场峰值：${s.rawMax.toFixed(2)}`;
    } else {
      peakPart = `相对场峰值：${s.rawMax.toFixed(2)}`;
    }
  }
  return `雷达目标：${s.radarObjects.length}  投影行人：${s.pedestrians.length}  接近关系：${s.interactions.length}  时间差：${timeDiffText}  ${peakPart}`;
});

const qualityGateLine = computed(() => {
  const s = fusionStore.snapshot;
  if (!s || s.quality.length === 0) {
    return COPY.FUSION_EMPTY;
  }
  return s.quality.join(' · ');
});

const computeLine = computed(() => {
  const s = fusionStore.snapshot;
  if (!s) return COPY.FUSION_BG_EMPTY;
  const merged = s.visionMergedCount ?? s.pedestrians.length + s.radarObjects.length;
  return `后台计算 ${s.computeMs} ms；雷达丢弃 ${s.radarDropped}；视觉合并 ${merged}`;
});

function importCalibration(): void {
  calibDraft.value = DEFAULT_CALIBRATION_POINTS.map((p) => ({ ...p }));
  fusionStore.applyCalibration(calibDraft.value);
  currentDemoMode.value = 'ok';
  appStore.showToast(COPY.FUSION_CALIBRATED);
}

function exportCalibration(): void {
  appStore.showToast('已导出地面标定文件 calibration_homography.json');
}

function confirmCalibration(): void {
  fusionStore.applyCalibration(calibDraft.value);
  currentDemoMode.value = 'ok';
  showCalibModal.value = false;
  appStore.showToast(COPY.FUSION_CALIBRATED);
}

function runSyntheticDemo(): void {
  radarStore.startReplay(true);
  visionStore.loadOfflineExample();
  switchDemo('ok');
  appStore.showToast('已启动合成界面演示（雷达合成流 + 视觉示例 + 地面标定）');
}

function chooseSaveDir(): void {
  fusionStore.saveDir = '/data/fusion_exp_20261016';
  appStore.showToast(`已切换融合保存目录：${fusionStore.saveDir}`);
}

function openFusionFolder(): void {
  const dir = fusionStore.sessionDirectory || fusionStore.saveDir;
  appStore.showToast(`融合会话目录：${dir}`);
}

function openCsvExportModal(): void {
  exportProgress.value = 100;
  exportDone.value = true;
  showCsvModal.value = true;
}

function runCsvExport(): void {
  exportDone.value = false;
  exportProgress.value = 25;
  setTimeout(() => {
    exportProgress.value = 70;
  }, 120);
  setTimeout(() => {
    exportProgress.value = 100;
    exportDone.value = true;
  }, 260);
}
</script>

<style scoped>
.fusion-page {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}

.section-heading-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 2px var(--sp-1);
}

.section-heading {
  font-size: var(--fs-cap);
  font-weight: 700;
  color: var(--c-ink);
}

.demo-state-pills {
  display: flex;
  align-items: center;
  gap: var(--sp-1);
}

.pill-label {
  font-size: var(--fs-xs);
  color: var(--c-ink-2);
}

.state-pill {
  height: 24px;
  padding: 0 8px;
  border-radius: var(--r-sm);
  border: 1px solid var(--c-border-strong);
  background: var(--c-surface);
  font-size: var(--fs-xs);
  cursor: pointer;
}

.state-pill.active {
  background: var(--c-canvas);
  color: var(--c-teal);
  border-color: var(--c-teal);
  font-weight: 600;
}

.action-bar,
.param-bar,
.save-bar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--sp-2);
}

.divider {
  color: var(--c-border-strong);
}

.num-sm {
  width: 64px;
}

.num-md {
  width: 78px;
}

.unit-text {
  font-size: var(--fs-cap);
  color: var(--c-ink-2);
}

.save-input {
  flex: 1;
  min-width: 200px;
}

.fusion-split {
  display: grid;
  grid-template-columns: 52fr 48fr;
  gap: var(--sp-3);
  min-height: 430px;
}

.pane-body {
  height: 410px;
}

.topview-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  gap: var(--sp-2);
}

.topview-title {
  font-size: var(--fs-cap);
  font-weight: 700;
  color: var(--c-ink);
}

.topview-actions {
  display: flex;
  gap: var(--sp-1);
}

.quality-rows {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: var(--fs-cap);
}

.q-row {
  padding: 2px 0;
  border-bottom: 1px solid var(--c-head);
}

.q-row:last-child {
  border-bottom: none;
}

.quality-gate {
  color: var(--c-ok);
  font-weight: 600;
}

.q-sep {
  margin: 0 var(--sp-2);
  color: var(--c-border-strong);
}

.mono {
  font-family: var(--font-mono);
  font-size: var(--fs-xs);
  color: var(--c-ink-2);
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
  z-index: 85;
}

.modal-card {
  width: 580px;
  background: var(--c-surface);
  border-radius: var(--r-md);
  padding: var(--sp-4);
  box-shadow: var(--shadow-elevated);
  border: 1px solid var(--c-border);
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

.session-list {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
  margin: var(--sp-2) 0 var(--sp-3);
}

.session-option {
  display: flex;
  align-items: flex-start;
  gap: var(--sp-2);
  padding: var(--sp-2);
  border: 1px solid var(--c-border);
  border-radius: var(--r-sm);
  cursor: pointer;
}

.session-option.selected {
  border-color: var(--c-ok);
  background: var(--c-ok-soft);
}

.s-dir {
  font-family: var(--font-mono);
  font-size: var(--fs-cap);
  font-weight: 600;
}

.s-meta {
  font-size: var(--fs-xs);
  color: var(--c-ink-2);
}

.progress-wrap {
  height: 8px;
  background: var(--c-head);
  border-radius: 999px;
  overflow: hidden;
  margin-bottom: var(--sp-3);
}

.progress-bar {
  height: 100%;
  background: var(--c-ok);
  transition: width 0.2s ease;
}

.export-result {
  background: var(--c-surface-alt);
  border: 1px solid var(--c-border);
  border-radius: var(--r-sm);
  padding: var(--sp-3);
  font-size: var(--fs-cap);
  margin-bottom: var(--sp-3);
}

.table-list {
  margin-top: var(--sp-2);
  padding-left: var(--sp-4);
}

.modal-actions {
  display: flex;
  justify-content: flex-end;
}

.calib-desc {
  font-size: var(--fs-cap);
  color: var(--c-ink-2);
  margin-bottom: var(--sp-2);
}

.calib-table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--fs-cap);
  margin-bottom: var(--sp-3);
}

.calib-table th,
.calib-table td {
  padding: var(--sp-1);
  border-bottom: 1px solid var(--c-head);
  text-align: left;
}
</style>
