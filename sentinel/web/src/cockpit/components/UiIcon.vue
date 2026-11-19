<script setup lang="ts">
withDefaults(defineProps<{ name: string; size?: number }>(), { size: 22 });
const paths: Record<string, string> = {
  radar: 'M12 2v3m0 14v3M2 12h3m14 0h3M12 12l6-6M9 12a3 3 0 1 0 3-3M6 12a6 6 0 1 0 6-6',
  camera: 'M15 8l6-3v14l-6-3M3 5h12v14H3zM6 8h5',
  risk: 'M12 3 2 21h20L12 3zM12 9v5m0 3v1',
  car: 'M4 10 6 5h12l2 5M3 10h18v8H3zM5 18v3m14-3v3M6 13h2m8 0h2',
  truck: 'M2 5h12v12H2zM14 9h5l3 4v4h-8M5 17v3m13-3v3',
  person: 'M12 3a2 2 0 1 0 0 4 2 2 0 0 0 0-4M12 8v7l-4 6m4-6 4 6M6 12l6-4 6 4',
  focus: 'M9 3H3v6m12-6h6v6M3 15v6h6m12-6v6h-6M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10',
  filter: 'M3 4h18l-7 8v8l-4-2v-6L3 4z',
  chevron: 'm9 5 7 7-7 7',
  arrow: 'M12 20V4m-6 6 6-6 6 6',
  pulse: 'M2 12h5l3-7 4 14 3-7h5',
  layers: 'm12 3 10 5-10 5L2 8l10-5zM2 12l10 5 10-5M2 16l10 5 10-5',
  link: 'm9 15 6-6M7 14l-2 2a3 3 0 0 0 4 4l3-3m0-10 3-3a3 3 0 0 1 4 4l-2 2',
  star: 'm12 3 3 6 6 1-4.5 4.5 1 6.5-5.5-3-5.5 3 1-6.5L3 10l6-1z',
};
</script>
<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.5"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path :d="paths[name] || paths.focus" />
  </svg>
</template>
