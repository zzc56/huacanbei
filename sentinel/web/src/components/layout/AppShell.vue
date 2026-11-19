<template>
  <div class="app-shell">
    <!-- Console Mode -->
    <template v-if="isConsole">
      <TopBanner />
      <ConsoleTabs />
      <div class="console-minwidth-guard">
        请使用更宽窗口（建议 ≥ 1280px 以获得 1:1 桌面端监控布局体验）
      </div>
      <main class="console-main">
        <slot />
      </main>
    </template>

    <!-- Official Portal Mode -->
    <template v-else>
      <header class="site-nav">
        <div class="site-nav-inner">
          <RouterLink to="/" class="brand-logo">
            <span class="brand-dot" />
            <span class="brand-name">雷达研究上位机</span>
            <span class="brand-ver">v0.3.6</span>
          </RouterLink>
          <nav class="nav-links" aria-label="官网主导航">
            <RouterLink to="/" exact-active-class="active">首页</RouterLink>
            <RouterLink to="/tech" active-class="active">技术架构</RouterLink>
            <RouterLink to="/demo" active-class="active">交互演示</RouterLink>
            <RouterLink to="/data" active-class="active">数据与诚实边界</RouterLink>
            <RouterLink to="/team" active-class="active">团队与分工</RouterLink>
          </nav>
          <div class="nav-cta">
            <RouterLink to="/console/radar" class="cta-btn">进入演示系统</RouterLink>
          </div>
        </div>
      </header>
      <main class="site-main">
        <slot />
      </main>
      <footer class="site-footer">
        <div class="site-footer-inner">
          <div class="footer-left">
            <strong>雷达研究上位机 v0.3.6</strong>
            <span class="sep">·</span>
            <span>{{ COPY.PROTOTYPE_BADGE }}</span>
          </div>
          <div class="footer-right">
            <span>{{ COPY.DATA_PAGE_BOUNDARY }}</span>
          </div>
        </div>
      </footer>
    </template>

    <!-- Global Toast -->
    <div v-if="appStore.toastMessage" class="global-toast" role="status">
      {{ appStore.toastMessage }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { COPY } from '@/types';
import { useAppStore } from '@/stores/app';
import TopBanner from './TopBanner.vue';
import ConsoleTabs from './ConsoleTabs.vue';

const route = useRoute();
const appStore = useAppStore();

const isConsole = computed(() => route.path.startsWith('/console'));
</script>

<style scoped>
.app-shell {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--c-bg);
}

.console-main {
  flex: 1;
  padding: var(--sp-3) var(--sp-4);
  max-width: 1920px;
  width: 100%;
  margin: 0 auto;
}

.site-nav {
  position: sticky;
  top: 0;
  z-index: 30;
  background: rgba(17, 28, 44, 0.92);
  backdrop-filter: blur(10px);
  border-bottom: 1px solid var(--c-grid);
}

.site-nav-inner {
  max-width: 1320px;
  margin: 0 auto;
  height: 60px;
  padding: 0 var(--sp-4);
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.brand-logo {
  display: inline-flex;
  align-items: center;
  gap: var(--sp-2);
  text-decoration: none;
  color: var(--c-surface);
  font-weight: 700;
  font-size: var(--fs-h2);
}

.brand-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--c-teal);
  box-shadow: var(--glow-teal);
}

.brand-ver {
  font-size: var(--fs-xs);
  padding: 1px 6px;
  border-radius: var(--r-sm);
  background: var(--c-grid);
  color: var(--c-teal);
  font-family: var(--font-mono);
}

.nav-links {
  display: flex;
  align-items: center;
  gap: var(--sp-4);
}

.nav-links a {
  color: var(--c-ink-3);
  text-decoration: none;
  font-size: var(--fs-body);
  font-weight: 500;
  padding: 6px 10px;
  border-radius: var(--r-sm);
  transition: all 0.15s ease;
}

.nav-links a:hover,
.nav-links a.active {
  color: var(--c-surface);
  background: rgba(68, 201, 190, 0.16);
}

.cta-btn {
  display: inline-flex;
  align-items: center;
  height: 34px;
  padding: 0 var(--sp-4);
  border-radius: var(--r-sm);
  background: var(--c-teal);
  color: var(--c-canvas);
  font-weight: 700;
  font-size: var(--fs-body);
  text-decoration: none;
  transition: filter 0.15s ease;
}

.cta-btn:hover {
  filter: brightness(1.06);
}

.site-main {
  flex: 1;
}

.site-footer {
  background: var(--c-canvas);
  color: var(--c-ink-3);
  border-top: 1px solid var(--c-grid);
  padding: var(--sp-4);
  font-size: var(--fs-cap);
}

.site-footer-inner {
  max-width: 1320px;
  margin: 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: var(--sp-2);
}

.sep {
  margin: 0 var(--sp-2);
  color: var(--c-axis);
}

.global-toast {
  position: fixed;
  bottom: var(--sp-5);
  right: var(--sp-5);
  background: var(--c-canvas);
  color: var(--c-surface);
  border: 1px solid var(--c-teal);
  padding: var(--sp-2) var(--sp-4);
  border-radius: var(--r-md);
  box-shadow: var(--shadow-elevated);
  font-size: var(--fs-cap);
  z-index: 100;
}
</style>
