<script setup lang="ts">
import { onUnmounted, ref } from 'vue';
import LiveCalibration from './LiveCalibration.vue';

type RadarSettings = { host: string; port: number; localAddress: string };
const radar = ref<HTMLDialogElement | null>(null);
const ready = ref(false);
const operation = ref<'load' | 'save' | null>(null);
const settings = ref<RadarSettings>({ host: '', port: 50000, localAddress: '' });
const error = ref('');
const status = ref('');
const requests = new AbortController();

onUnmounted(() => requests.abort());

async function update(operationName: 'load' | 'save') {
  if (operation.value) return;
  operation.value = operationName;
  error.value = '';
  status.value = '';
  try {
    const data = { host: settings.value.host.trim(), port: settings.value.port, localAddress: settings.value.localAddress.trim() };
    const response = await fetch('/api/live/radar-settings', {
      signal: requests.signal,
      ...(operationName === 'save' ? {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
      } : {}),
    });
    const result = await response.json().catch(() => null);
    if (!response.ok || typeof result?.host !== 'string' || typeof result?.port !== 'number') {
      error.value = result?.message || '无法读取雷达设置，请确认实时服务已启动。';
      return;
    }
    settings.value = result as RadarSettings;
    ready.value = true;
    if (operationName === 'save') status.value = '设置已保存，雷达已开始重新连接。';
  } catch {
    if (!requests.signal.aborted) error.value = '无法连接实时服务，请稍后重试。';
  } finally {
    operation.value = null;
  }
}

async function openSettings() {
  if (!radar.value || radar.value.open || operation.value) return;
  ready.value = false;
  radar.value.showModal();
  await update('load');
}

function keepOpenWhileBusy(event: Event) {
  if (operation.value) event.preventDefault();
}
</script>

<template>
  <div class="live-controls">
    <button type="button" class="live-control" @click="openSettings">雷达设置</button>
    <LiveCalibration />
  </div>
  <Teleport to="body">
    <dialog ref="radar" class="radar-settings" aria-labelledby="radar-settings-title" @cancel="keepOpenWhileBusy">
      <header>
        <h2 id="radar-settings-title">雷达设置</h2>
        <button type="button" aria-label="关闭雷达设置" :disabled="!!operation" @click="radar?.close()">×</button>
      </header>
      <form :aria-busy="!!operation" @submit.prevent="update('save')">
        <fieldset :disabled="!ready || !!operation">
          <label>雷达 IPv4 地址 <input v-model="settings.host" type="text" spellcheck="false" maxlength="15" placeholder="填写雷达的实际 IPv4 地址" required /></label>
          <label>TCP 端口 <input v-model.number="settings.port" type="number" min="1" max="65535" step="1" required /></label>
          <label>本机网卡 IPv4 地址 <input v-model="settings.localAddress" type="text" spellcheck="false" maxlength="15" placeholder="留空自动选择" /></label>
        </fieldset>
        <p v-if="error" class="settings-error" role="alert">{{ error }}</p>
        <p v-else-if="operation === 'load'" role="status">正在读取雷达设置…</p>
        <p v-else-if="status" role="status">{{ status }}</p>
        <footer>
          <button v-if="!ready && !operation" type="button" @click="update('load')">重试</button>
          <button v-else type="submit" :disabled="!ready || !!operation">{{ operation === 'save' ? '正在保存…' : '保存并重新连接' }}</button>
        </footer>
      </form>
    </dialog>
  </Teleport>
</template>

<style scoped>
.live-controls { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; white-space: nowrap; }
.live-controls :deep(.live-control) {
  padding: 6px 9px;
  border: 1px solid #cadce5;
  border-radius: 6px;
  background: #eef6f9;
  color: #255e72;
  font-size: 12px;
}
.live-controls :deep(.live-control:hover) { background: #dcecf3; }
.radar-settings {
  position: fixed;
  inset: 0;
  box-sizing: border-box;
  width: min(430px, calc(100% - 24px));
  height: fit-content;
  max-height: calc(100dvh - 24px);
  margin: auto;
  padding: 18px;
  overflow: auto;
  border: 1px solid #cad8e1;
  border-radius: 12px;
  background: #fcfeff;
  color: #17323c;
  box-shadow: 0 14px 48px #19394b38;
  font-family: 'Microsoft YaHei', 'Segoe UI', sans-serif;
  font-size: 14px;
}
.radar-settings::backdrop { background: #10283480; }
.radar-settings header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; }
.radar-settings h2 { margin: 0; font-size: 18px; }
.radar-settings fieldset { display: grid; gap: 12px; margin: 0; padding: 0; border: 0; }
.radar-settings label { display: grid; gap: 5px; }
.radar-settings input {
  min-width: 0;
  padding: 8px;
  border: 1px solid #cad8e1;
  border-radius: 6px;
  font: inherit;
}
.radar-settings button { border: 0; border-radius: 6px; font: inherit; cursor: pointer; }
.radar-settings button:disabled { opacity: .65; cursor: default; }
.radar-settings header button { padding: 2px 9px; background: #edf6f8; color: #255e72; font-size: 20px; }
.radar-settings footer { display: flex; justify-content: flex-end; margin-top: 14px; }
.radar-settings footer button { padding: 8px 12px; background: #136a70; color: white; }
.radar-settings p { margin: 10px 0 0; color: #27665f; }
.radar-settings .settings-error { color: #9d352c; }
</style>
