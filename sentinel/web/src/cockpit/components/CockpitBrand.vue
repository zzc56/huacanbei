<script setup lang="ts">
defineProps<{ title: string; subtitle: string }>();
</script>
<template>
  <div class="brand">
    <svg viewBox="0 0 56 64" aria-hidden="true">
      <defs>
        <linearGradient id="brand-gradient" x1="0" y1="0" x2="1" y2="1">
          <stop stop-color="#123a49" />
          <stop offset=".5" stop-color="#008f9d" />
          <stop offset="1" stop-color="#50dec9" />
        </linearGradient>
      </defs>
      <path d="M28 3 47 16 52 36 39 55 28 61 10 47 4 28 15 10Z" fill="url(#brand-gradient)" />
      <path d="m28 10 13 14-2 18-11 13-13-15 3-18Z" fill="#e7fbf7" />
      <path d="m28 14 5 18-5 20-5-20Z" fill="#008e9b" />
      <path d="M28 3v9M28 52v9" stroke="#e9ffff" stroke-width="1.5" />
    </svg>
    <div>
      <h1>{{ title }}</h1>
      <p>{{ subtitle }}</p>
    </div>
  </div>
</template>
