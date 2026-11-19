<script setup lang="ts">
import { ref,watch,onUnmounted } from 'vue';
const props=withDefaults(defineProps<{value:number|null;digits?:number;pad?:number}>(),{digits:0,pad:0});
const shown=ref<number|null>(props.value);let raf=0;
watch(()=>props.value,(value)=>{
  cancelAnimationFrame(raf);
  if(value===null||shown.value===null||window.matchMedia('(prefers-reduced-motion: reduce)').matches){shown.value=value;return;}
  const from=shown.value,start=performance.now();
  const tick=(now:number)=>{const t=Math.max(0,Math.min(1,(now-start)/180));shown.value=from+(value-from)*(1-(1-t)**3);if(t<1)raf=requestAnimationFrame(tick);};
  raf=requestAnimationFrame(tick);
});
onUnmounted(()=>cancelAnimationFrame(raf));
</script>
<template><span style="font:inherit;color:inherit;margin:0;display:inline;letter-spacing:inherit" :data-value="value" :aria-label="value===null?'未知':value.toFixed(digits)">{{ shown===null?'—':shown.toFixed(digits).padStart(pad,'0') }}</span></template>
