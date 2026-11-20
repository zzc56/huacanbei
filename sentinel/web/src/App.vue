<template>
  <Dashboard v-if="route.path === '/'" />
  <RouterView v-else-if="route.name === 'vehicle'" />
  <AppShell v-else>
    <RouterView />
  </AppShell>
</template>

<script setup lang="ts">
import AppShell from '@/components/layout/AppShell.vue';
import Dashboard from '@/cockpit/Dashboard.vue';
import { useRoute } from 'vue-router';
const route = useRoute();
</script>
