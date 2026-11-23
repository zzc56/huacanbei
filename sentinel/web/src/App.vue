<template>

  <Dashboard v-if="isMonitor" :key="source" :source="source" @change-source="changeSource" />
  <AppShell v-else>
    <RouterView />
  </AppShell>
</template>

<script setup lang="ts">
import AppShell from '@/components/layout/AppShell.vue';

import Dashboard from '@/cockpit/Dashboard.vue';
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import type { MonitorSource } from '@/cockpit/services/stream';
const route = useRoute();
const router = useRouter();
const isMonitor = computed(() => route.path === '/' || route.path === '/history');
const source = computed<MonitorSource>(() => route.path === '/history' || route.query.mode === 'recording' ? 'recording' : 'live');
function changeSource(value: MonitorSource) {
  if (value !== source.value) void router.push(value === 'recording' ? '/history' : '/?mode=live');
}
</script>


