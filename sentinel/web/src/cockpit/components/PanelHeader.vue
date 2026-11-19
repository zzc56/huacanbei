<script setup lang="ts">
defineProps<{ index: string; title: string; english: string; status?: string }>();
</script>
<template>
  <header class="panel-heading">
    <div class="panel-name">
      <span class="panel-index">{{ index }}</span>
      <h2>{{ title }}</h2>
      <span class="panel-english">{{ english }}</span>
    </div>
    <div class="panel-status"><i></i>{{ status || '实时同步' }}</div>
  </header>
</template>
