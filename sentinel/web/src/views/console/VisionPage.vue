<template>
  <div class="vision-page">
    <!-- 1. 标题 -->
    <div class="section-heading">{{ COPY.VISION_TITLE }}</div>

    <!-- 2. 设置卡（白底 3 行） -->
    <CardPanel dense>
      <div class="settings-rows">
        <!-- 行 1 -->
        <div class="settings-row">
          <FieldLabel>画面来源</FieldLabel>
          <div class="source-select">
            <AppSelect
              v-model="visionStore.sourceKind"
              :options="sourceOptions"
              aria-label="画面来源"
            />
          </div>
          <div class="source-input">
            <AppInput
              v-model="visionStore.sourceAddress"
              :type="visionStore.sourceKind === 'rtsp' ? 'password' : 'text'"
              :placeholder="sourcePlaceholder"
              aria-label="画面源地址"
            />
          </div>
          <AppButton
            v-if="visionStore.sourceKind === 'file' || visionStore.sourceKind === 'image'"
            @click="chooseSampleFile"
          >
            选择文件…
          </AppButton>
        </div>

        <!-- 行 2：来源提示灰字 -->
        <div class="source-hint-row">
          {{ visionStore.sourceHint }}
        </div>

        <!-- 行 3：保存目录 -->
        <div class="settings-row">
          <FieldLabel>保存目录</FieldLabel>
          <div class="save-input">
            <AppInput
              v-model="visionStore.saveDir"
              :readonly="visionStore.status.recording"
              aria-label="视觉保存目录"
            />
          </div>
          <AppButton
            :disabled="visionStore.status.recording"
            @click="chooseSaveDir"
          >
            选择目录…
          </AppButton>
        </div>
      </div>
    </CardPanel>

    <!-- 3. 动作条 -->
    <CardPanel dense>
      <div class="action-bar">
        <AppButton
          variant="primary"
          :disabled="visionStore.status.running"
          @click="visionStore.startDetection()"
        >
          开始检测
        </AppButton>
        <AppButton
          variant="danger"
          :disabled="!visionStore.status.running"
          @click="visionStore.stopDetection()"
        >
          停止检测
        </AppButton>
        <AppButton
          :disabled="!visionStore.status.running || visionStore.status.recording"
          @click="visionStore.startRecording()"
        >
          保存采样与结果
        </AppButton>
        <AppButton
          :disabled="!visionStore.status.recording"
          @click="visionStore.stopRecording()"
        >
          停止保存
        </AppButton>
        <AppButton @click="openVisionFolder">
          打开文件夹
        </AppButton>
        <AppButton @click="visionStore.loadOfflineExample()">
          离线示例
        </AppButton>

        <span class="divider">|</span>

        <FieldLabel>置信度</FieldLabel>
        <div class="num-box">
          <AppInput
            v-model="visionStore.confidence"
            type="number"
            compact
            :min="0.05"
            :max="0.95"
            :step="0.05"
            aria-label="检测置信度阈值"
          />
        </div>

        <FieldLabel>采样上限</FieldLabel>
        <div class="num-box">
          <AppInput
            v-model="visionStore.maxFps"
            type="number"
            compact
            :min="1"
            :max="10"
            :step="1"
            aria-label="采样上限帧率"
          />
        </div>
        <span class="unit-text">帧/秒</span>
      </div>
    </CardPanel>

    <!-- 4. 主体：深底 VideoOverlay -->
    <CardPanel class="video-panel">
      <div class="video-stage">
        <VideoOverlay
          :frame="visionStore.currentFrame"
          :boxes="visionStore.visibleBoxes"
        />
      </div>
    </CardPanel>

    <!-- 5. 指标条 -->
    <MetricBar
      :status="visionStore.status"
      :frame="visionStore.currentFrame"
      :person-count="visionStore.personCount"
      :vehicle-count="visionStore.vehicleCount"
    />

    <!-- 6. 页脚 -->
    <p class="page-footnote">{{ COPY.VISION_FOOTER }}</p>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { COPY } from '@/types';
import { useVisionStore } from '@/stores/vision';
import { useAppStore } from '@/stores/app';
import CardPanel from '@/components/ui/CardPanel.vue';
import FieldLabel from '@/components/ui/FieldLabel.vue';
import AppSelect from '@/components/ui/AppSelect.vue';
import AppInput from '@/components/ui/AppInput.vue';
import AppButton from '@/components/ui/AppButton.vue';
import VideoOverlay from '@/components/charts/VideoOverlay.vue';
import MetricBar from '@/components/charts/MetricBar.vue';

const visionStore = useVisionStore();
const appStore = useAppStore();

const sourceOptions = [
  { label: '网络摄像头（RTSP）', value: 'rtsp' },
  { label: '本机 / OBS 摄像头', value: 'camera' },
  { label: '本地视频（离线）', value: 'file' },
  { label: '本地图片（离线）', value: 'image' }
];

const sourcePlaceholder = computed(() => {
  if (visionStore.sourceKind === 'rtsp') return 'rtsp://192.0.2.30:554/Streaming/Channels/101';
  if (visionStore.sourceKind === 'camera') return '0';
  if (visionStore.sourceKind === 'image') return '/mock/road-sample.jpg';
  return '/data/samples/intersection_daylight_720p.mp4';
});

onMounted(() => {
  visionStore.init();
  if (!visionStore.currentFrame) {
    visionStore.loadOfflineExample();
  }
});

function chooseSampleFile(): void {
  if (visionStore.sourceKind === 'image') {
    visionStore.sourceAddress = '/mock/road-sample.jpg';
  } else {
    visionStore.sourceAddress = '/data/samples/urban_crosswalk_60f.mp4';
  }
  appStore.showToast(`已选择离线素材：${visionStore.sourceAddress}`);
}

function chooseSaveDir(): void {
  visionStore.saveDir = '/data/vision_exp_20261016';
  appStore.showToast(`已设置保存目录：${visionStore.saveDir}`);
}

function openVisionFolder(): void {
  const dir = visionStore.status.sessionDirectory || visionStore.saveDir;
  appStore.showToast(`视觉实验目录：${dir}`);
}
</script>

<style scoped>
.vision-page {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}

.section-heading {
  font-size: var(--fs-cap);
  font-weight: 700;
  color: var(--c-ink);
  padding: 2px var(--sp-1);
}

.settings-rows {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}

.settings-row {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
}

.source-select {
  width: 210px;
}

.source-input,
.save-input {
  flex: 1;
}

.source-hint-row {
  font-size: var(--fs-cap);
  color: var(--c-ink-2);
  padding-left: 64px;
}

.action-bar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--sp-2);
}

.divider {
  color: var(--c-border-strong);
  margin: 0 var(--sp-1);
}

.num-box {
  width: 72px;
}

.unit-text {
  font-size: var(--fs-cap);
  color: var(--c-ink-2);
}

.video-stage {
  height: 440px;
}

.page-footnote {
  font-size: var(--fs-cap);
  color: var(--c-ink-2);
  padding: 2px var(--sp-1);
}
</style>
