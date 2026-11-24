<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef } from 'vue';
import { replayDataFiles, type ImportedReplay, type ReplayDataFile, type ReplayRecording } from '../data/bundledReplay';

import { decodeReplay } from '../data/replayArchive';

const emit = defineEmits<{ imported: [recording: ReplayRecording] }>();
const dialog = ref<HTMLDialogElement>();
const filePicker = ref<HTMLInputElement>();
const folderPicker = ref<HTMLInputElement>();
const files = shallowRef<Partial<Record<'video' | ReplayDataFile, File>>>({});
const archive = shallowRef<File>();
const required = ['video', ...replayDataFiles] as const;
const complete = computed(() => !!archive.value || required.every(key => files.value[key]));
const annotated = ref(false);
const loading = ref(false);
const error = ref('');
let pending: AbortController | undefined;

function open() {
  files.value = {};
  archive.value = undefined;
  annotated.value = false;
  error.value = '';
  dialog.value?.showModal();
}

function addFiles(event: Event) {
  const input = event.currentTarget as HTMLInputElement;
  const selected = Array.from(input.files ?? []);
  input.value = '';
  if (selected.length === 1 && /\.zip$/i.test(selected[0].name)) {
    archive.value = selected[0];
    error.value = '';
    return;
  }
  const next: typeof files.value = {};
  for (const file of selected) {
    const name = file.name.toLowerCase();
    const key = /\.(mp4|webm)$/.test(name) ? 'video' : replayDataFiles.find((item) => item === name);
    if (!key) continue;
    if (next[key]) {
      error.value = '这次选择中有重复的文件，请只选择同一组回放数据。';
      return;
    }
    next[key] = file;
  }
  if (!Object.keys(next).length) {
    error.value = '没有找到支持的录像或配套数据文件。';
    return;
  }
  archive.value = undefined;
  files.value = { ...files.value, ...next };
  error.value = '';
}

function readVideoDuration(file: File, signal: AbortSignal) {
  return new Promise<number>((resolve, reject) => {
    const video = document.createElement('video');
    const url = URL.createObjectURL(file);
    const finish = (failure?: Error) => {
      clearTimeout(timeout);
      signal.removeEventListener('abort', cancel);
      const duration = video.duration * 1000;
      video.onloadeddata = null;
      video.onerror = null;
      video.removeAttribute('src');
      video.load();
      URL.revokeObjectURL(url);
      if (failure) reject(failure);
      else resolve(duration);
    };
    const cancel = () => finish(new DOMException('Cancelled', 'AbortError'));
    const unreadable = () => finish(new Error('无法读取录像，请选择浏览器能播放的 MP4 或 WebM 文件。'));
    const timeout = window.setTimeout(unreadable, 8000);
    signal.addEventListener('abort', cancel, { once: true });
    video.onloadeddata = () => Number.isFinite(video.duration) && video.duration > 0 ? finish() : unreadable();
    video.onerror = unreadable;
    video.preload = 'auto';
    video.src = url;
  });
}

function parseFiles(data: File[], signal: AbortSignal) {
  return new Promise<ImportedReplay['packets']>((resolve, reject) => {
    const worker = new Worker(new URL('../data/replayImport.worker.ts', import.meta.url), { type: 'module' });
    const cancel = () => {
      worker.terminate();
      reject(new DOMException('Cancelled', 'AbortError'));
    };
    const finish = (result: { packets?: ImportedReplay['packets']; error?: string }) => {
      signal.removeEventListener('abort', cancel);
      worker.terminate();
      if (result.packets) resolve(result.packets);
      else reject(new Error(result.error ?? '回放数据解析失败。'));
    };
    signal.addEventListener('abort', cancel, { once: true });
    worker.onmessage = (event) => finish(event.data);
    worker.onerror = () => finish({ error: '回放数据解析失败。' });
    worker.postMessage({ files: data, annotated: annotated.value });
  });
}

function cancelImport() {
  pending?.abort();
}

async function importReplay() {
  const video = files.value.video;
  const packageFile = archive.value;
  if (!complete.value || loading.value) return;
  const task = pending = new AbortController();
  loading.value = true;
  error.value = '';
  try {
    if (packageFile) {
      const replay = await decodeReplay(packageFile);
      if (!task.signal.aborted) { emit('imported', replay); dialog.value?.close(); }
      return;
    }
    if (!video) return;
    const [packets, duration] = await Promise.all([
      parseFiles(replayDataFiles.map((key) => files.value[key]!), task.signal),
      readVideoDuration(video, task.signal),
    ]);
    if (packets[0].pts > duration + 40) throw new Error('数据时间超出录像时长，请选择同一次采集的文件。');
    if (task.signal.aborted) return;
    emit('imported', { video, packets, durationMs: Math.round(duration) });
    dialog.value?.close();
  } catch (failure) {
    if (!task.signal.aborted) {
      error.value = failure instanceof Error ? failure.message : '回放数据导入失败。';
    }
  } finally {
    task.abort();
    if (pending === task) {
      pending = undefined;
      loading.value = false;
    }
  }
}

onBeforeUnmount(cancelImport);
</script>

<template>
  <button class="replay-import-button" type="button" @click="open">导入回放</button>

  <Teleport to="body">
    <dialog ref="dialog" class="replay-import" aria-labelledby="replay-import-title" @cancel="cancelImport" @close="cancelImport">
      <form @submit.prevent="importReplay">
        <header class="import-header">
          <h2 id="replay-import-title">导入回放</h2>
          <button type="button" class="icon-close" aria-label="关闭导入窗口" @click="dialog?.close()">×</button>
        </header>
        <p>选择 Sentinel 导出的 ZIP，或同一次采集的录像和数据文件。</p>

        <div class="file-actions">
          <button type="button" :disabled="loading" @click="filePicker?.click()">选择文件</button>
          <button type="button" :disabled="loading" @click="folderPicker?.click()">选择文件夹</button>
        </div>
        <input ref="filePicker" type="file" multiple accept=".mp4,.webm,.csv,.jsonl,.zip" hidden @change="addFiles" />
        <input ref="folderPicker" type="file" webkitdirectory hidden @change="addFiles" />
        <p v-if="archive">{{ archive.name }}</p>
        <dl v-else class="file-list">
          <div v-for="key in required" :key="key">
            <dt>{{ key === 'video' ? '录像 · MP4 / WebM' : key }}</dt>
            <dd>{{ files[key]?.name ?? '待选择' }}</dd>
          </div>
        </dl>
        <label v-if="!archive" class="annotation-option">
          <input v-model="annotated" type="checkbox" :disabled="loading" />
          视频已带检测框
        </label>
        <p v-if="error" class="import-error" role="alert">{{ error }}</p>
        <p v-else-if="loading" role="status">正在解析并对齐数据…</p>
        <button class="import-submit" type="submit" :disabled="!complete || loading">解析并回放</button>
      </form>
    </dialog>
  </Teleport>
</template>

<style scoped>
.replay-import {
  position: fixed;
  inset: 0;
  width: min(480px, calc(100% - 28px));
  height: fit-content;
  max-height: calc(100dvh - 28px);
  margin: auto;
  padding: 20px;
  overflow: auto;
  color: #173744;
  background: #f8fbfe;
  border: 1px solid #b9ced8;
  border-radius: 14px;
  box-shadow: 0 20px 60px #192f4270;
}

.replay-import::backdrop { background: #0e253a91; }
.import-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
h2 { font-size: 21px; }
p { margin: 8px 0 12px; color: #465f70; }
button { cursor: pointer; }
button:disabled { cursor: default; opacity: 0.55; }
.icon-close { width: 34px; height: 34px; border: 0; background: transparent; font-size: 26px; }
.file-actions { display: flex; gap: 8px; }
.file-actions button, .import-submit { padding: 8px 12px; border: 1px solid #a7c7d0; border-radius: 7px; background: #e5f1f5; }
.file-list { margin: 12px 0; }
.file-list div { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; padding: 6px 0; border-bottom: 1px solid #d9e6eb; }
.file-list dt { font-weight: 600; }
.file-list dd { color: #465f70; overflow-wrap: anywhere; }
.annotation-option { display: flex; gap: 8px; align-items: center; }
.import-error { color: #8f2525; }
.import-submit { display: block; margin-left: auto; color: #fff; background: #136a70; }
</style>
