<template>
  <nav class="console-tabs" aria-label="上位机功能导航">
    <div class="tabs-left">
      <RouterLink
        to="/console/radar"
        class="tab-item"
        active-class="active"
      >
        <span class="tab-index">01</span>
        雷达采集
      </RouterLink>
      <RouterLink
        to="/console/vision"
        class="tab-item"
        active-class="active"
      >
        <span class="tab-index">02</span>
        人车视觉
      </RouterLink>
      <RouterLink
        to="/console/fusion"
        class="tab-item"
        active-class="active"
      >
        <span class="tab-index">03</span>
        融合与风险场
      </RouterLink>
    </div>
    <div class="tabs-right">
      <span class="mode-tag">数据通道：MockTransport (可无缝切换 HttpTransport)</span>
    </div>
  </nav>
</template>

<script setup lang="ts">
</script>

<style scoped>
.console-tabs {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: var(--c-surface);
  padding: 0 var(--sp-4);
  height: 38px;
  border-bottom: 1px solid var(--c-border);
}

.tabs-left {
  display: flex;
  align-items: center;
  gap: var(--sp-1);
  height: 100%;
}

.tab-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 100%;
  padding: 0 var(--sp-4);
  font-size: var(--fs-body);
  font-weight: 600;
  color: var(--c-ink-2);
  text-decoration: none;
  border-bottom: 2px solid transparent;
  transition: all 0.15s ease;
}

.tab-item:hover {
  color: var(--c-ink);
  background: var(--c-surface-alt);
}

.tab-item.active {
  color: var(--c-ink);
  border-bottom-color: var(--c-teal);
  background: var(--c-row-alt);
}

.tab-index {
  font-size: var(--fs-xs);
  color: var(--c-teal-dark);
  font-family: var(--font-mono);
}

.mode-tag {
  font-size: var(--fs-xs);
  color: var(--c-ink-2);
}
</style>
