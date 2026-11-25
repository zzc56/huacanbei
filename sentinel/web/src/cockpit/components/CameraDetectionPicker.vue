<script setup lang="ts">
import { computed, ref } from 'vue';

const props = defineProps<{ endpoint: URL }>();
const available = ref<string[]>([]), selected = ref<string[]>([]);
const query = ref(''), message = ref(''), busy = ref(false);
const names: Record<string,string> = {
  person:'人', bicycle:'自行车', car:'汽车', motorcycle:'摩托车', bus:'公交车', truck:'卡车',
  'sports ball':'球', bottle:'瓶子', cup:'杯子', book:'书', 'teddy bear':'玩偶',
  chair:'椅子', backpack:'背包', banana:'香蕉', apple:'苹果', 'tissue box':'纸巾盒',
};
const filtered = computed(() => {
  const term = query.value.trim().toLowerCase();
  return available.value.filter(label => label.toLowerCase().includes(term) || names[label]?.includes(term));
});

async function update(save = false) {
  if (busy.value) return;
  busy.value = true;
  message.value = '';
  try {
    const response = await fetch(new URL('/api/vehicle/camera-classes', props.endpoint), {
      cache:'no-store', signal:AbortSignal.timeout(3000),
      ...(save ? {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({selected:selected.value})} : {}),
    });
    const data = await response.json();
    if (!response.ok) throw Error(response.status === 404 ? '请启动新版车路协同后端。' : data.error ?? '读取类别失败。');
    available.value = data.available;
    selected.value = data.selected;
    message.value = save ? '已应用到实时检测' : available.value.length ? '' : '等待检测模型加载，再刷新类别。';
  } catch (cause) {
    message.value = cause instanceof Error ? cause.message : '读取类别失败。';
  } finally {
    busy.value = false;
  }
}
function opened(event: Event) {
  if ((event.currentTarget as HTMLDetailsElement).open) void update();
}
</script>

<template>
  <details class="detection-picker" @toggle="opened">
    <summary>识别类别</summary>
    <input v-model="query" type="search" aria-label="搜索识别类别" placeholder="搜球、瓶子或模型类别" />
    <fieldset v-if="available.length" :disabled="busy">
      <legend>模型支持的类别</legend>
      <div class="classes">
        <label v-for="label in filtered" :key="label">
          <input v-model="selected" type="checkbox" :value="label" />
          {{ names[label] ? names[label] + ' · ' + label : label }}
        </label>
        <p v-if="!filtered.length">没有匹配类别</p>
      </div>
    </fieldset>
    <div class="actions">
      <button type="button" :disabled="busy" @click="update()">刷新类别</button>
      <button v-if="available.length" type="button" :disabled="busy" @click="update(true)">应用选择</button>
    </div>
    <p v-if="message" role="status">{{ message }}</p>
  </details>
</template>

<style scoped>
.detection-picker { margin-top:6px; padding:5px 8px; border:1px solid #a8cdd6; border-radius:5px; color:#195367; font-size:12px; }
summary { cursor:pointer; }
input[type="search"] { width:100%; margin:6px 0; padding:4px 6px; border:1px solid #a8cdd6; border-radius:4px; background:#f7fbfc; }
fieldset { padding:0; border:0; }
.classes { display:flex; flex-wrap:wrap; gap:6px 10px; max-height:135px; overflow:auto; }
label { display:flex; align-items:center; gap:3px; }
.actions { display:flex; gap:8px; margin:5px 0; }
.detection-picker button { padding:3px 6px; border:1px solid #a8cdd6; border-radius:4px; }
.detection-picker button:disabled { opacity:.55; }
</style>
