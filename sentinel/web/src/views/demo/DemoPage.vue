<template>
  <div class="demo-page">
    <header class="demo-header">
      <div>
        <h1>上位机交互演示台（支持三态门控一键切换）</h1>
        <p>可直接在此页内嵌操作三大工作台，或跳转独立全屏上位机视图进行答辩演示</p>
      </div>
      <div class="demo-controls">
        <AppButton
          :variant="activeTab === 'radar' ? 'primary' : 'default'"
          @click="activeTab = 'radar'"
        >
          01 雷达采集
        </AppButton>
        <AppButton
          :variant="activeTab === 'vision' ? 'primary' : 'default'"
          @click="activeTab = 'vision'"
        >
          02 人车视觉
        </AppButton>
        <AppButton
          :variant="activeTab === 'fusion' ? 'primary' : 'default'"
          @click="activeTab = 'fusion'"
        >
          03 融合与风险场
        </AppButton>
        <span class="sep">|</span>
        <AppButton compact @click="triggerDemoState('ok')">演示态：ok</AppButton>
        <AppButton compact @click="triggerDemoState('expired')">演示态：expired</AppButton>
        <AppButton compact @click="triggerDemoState('uncalibrated')">演示态：uncalibrated</AppButton>
      </div>
    </header>

    <div class="embedded-console">
      <RadarPage v-if="activeTab === 'radar'" />
      <VisionPage v-else-if="activeTab === 'vision'" />
      <FusionPage v-else />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useFusionStore } from '@/stores/fusion';
import type { FusionDemoMode } from '@/data/mock/fusionSim';
import AppButton from '@/components/ui/AppButton.vue';
import RadarPage from '@/views/console/RadarPage.vue';
import VisionPage from '@/views/console/VisionPage.vue';
import FusionPage from '@/views/console/FusionPage.vue';

const activeTab = ref<'radar' | 'vision' | 'fusion'>('fusion');
const fusionStore = useFusionStore();

function triggerDemoState(mode: FusionDemoMode): void {
  activeTab.value = 'fusion';
  fusionStore.setDemoState(mode);
}
</script>

<style scoped>
.demo-page {
  max-width: 1440px;
  margin: 0 auto;
  padding: var(--sp-4);
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
}

.demo-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: var(--sp-3);
  background: var(--c-surface);
  padding: var(--sp-3) var(--sp-4);
  border-radius: var(--r-md);
  border: 1px solid var(--c-border);
}

.demo-header h1 {
  font-size: var(--fs-h2);
  font-weight: 800;
}

.demo-header p {
  font-size: var(--fs-cap);
  color: var(--c-ink-2);
}

.demo-controls {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--sp-2);
}

.sep {
  color: var(--c-border-strong);
}

.embedded-console {
  border: 2px solid var(--c-border-strong);
  border-radius: var(--r-md);
  padding: var(--sp-3);
  background: var(--c-bg);
}
</style>
