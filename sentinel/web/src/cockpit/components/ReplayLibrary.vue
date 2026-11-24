<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { loadBundledReplay, type ReplayRecording } from '../data/bundledReplay';
import { downloadReplay, encodeReplay, listSavedReplays, openSavedReplay, saveReplay, savedReplayUrl, type ReplayEntry } from '../data/replayArchive';
import { useReplayRecorder } from '../composables/useReplayRecorder';
import { useSceneStore } from '../stores/scene';

const props = defineProps<{ source: 'live' | 'recording'; current?: ReplayRecording; bundled?: boolean; name: string }>();
const emit = defineEmits<{ play: [recording: ReplayRecording] }>();
const store = useSceneStore();
const dialog = ref<HTMLDialogElement>();
const busy = ref(false);
const error = ref('');
const notice = ref('');
const entries = ref<ReplayEntry[]>([]);
const name = ref('');
const duration = computed(() => props.current?.durationMs ?? store.frame.replay?.durationMs ?? 0);
const canCapture = computed(() => store.connection === 'connected' && store.playing &&
  (!!store.frame.cameraFrame?.imageUrl || store.frame.live?.radar.state === 'streaming'));

const recorder = useReplayRecorder(persistLive);
const { recording, draft, elapsedMs } = recorder;

function dateLabel(time: number) {
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'medium', hour12: false }).format(time);
}
function formatDuration(ms: number) { return `${(ms / 1000).toFixed(1)} 秒`; }
function label(error: unknown) { return error instanceof Error ? error.message : '回放操作失败。'; }

async function perform(action: () => Promise<void>) {
  if (busy.value) return;
  busy.value = true;
  error.value = '';
  notice.value = '';
  try { await action(); }
  catch (failure) { error.value = label(failure); }
  finally { busy.value = false; }
}

async function persistLive(item: ReplayRecording) {
  await perform(async () => {
    const title = item.name ?? '实时录制';
    const durationMs = item.durationMs!;
    await saveReplay(title, durationMs, await encodeReplay(item, title, durationMs));
    draft.value = undefined;
    notice.value = '录制已保存，可在历史回放的回放库中查看。';
  });
}
async function open() {
  name.value = props.name.replace(/\.(mp4|webm)$/i, '');
  dialog.value?.showModal();
  await perform(async () => { entries.value = await listSavedReplays(); });
}
async function useCurrent(exporting: boolean) {
  const durationMs = duration.value;
  const title = name.value.trim() || props.name;
  if (durationMs <= 0) return;
  await perform(async () => {
    const item = props.current ?? (props.bundled ? await loadBundledReplay(AbortSignal.timeout(30_000)) : undefined);
    if (!item) throw new Error('当前回放尚未准备好。');
    const archive = await encodeReplay(item, title, durationMs);
    if (exporting) downloadReplay(archive, title);
    else {
      const entry = await saveReplay(title, durationMs, archive);
      entries.value = [entry, ...entries.value];
      notice.value = '当前回放已保存。';
    }
  });
}
async function play(entry: ReplayEntry) {
  await perform(async () => {
    emit('play', await openSavedReplay(entry.id));
    dialog.value?.close();
  });
}
function start() {
  error.value = '';
  notice.value = '';
  recorder.start('实时录制 ' + dateLabel(Date.now()));
}
async function exportDraft() {
  const item = draft.value;
  if (!item) return;
  await perform(async () => downloadReplay(await encodeReplay(item, item.name, item.durationMs), item.name));
}
watch(() => props.source, () => { if (recording.value) void recorder.stop(); });
</script>

<template>
  <div class="library-actions">
    <button v-if="source === 'recording'" type="button" @click="open">回放库</button>
    <template v-else>
      <button v-if="recording" type="button" @click="recorder.stop()">停止并保存 {{ formatDuration(elapsedMs) }}</button>
      <template v-else-if="draft">
        <button type="button" :disabled="busy" @click="persistLive(draft)">重试保存</button>
        <button type="button" :disabled="busy" @click="exportDraft">导出录制</button>
      </template>
      <button v-else type="button" :disabled="busy || !canCapture" @click="start">开始录制</button>
      <span v-if="error" class="library-error" role="alert">{{ error }}</span>
      <span v-else-if="notice" role="status">{{ notice }}</span>
    </template>
  </div>
  <Teleport to="body">
    <dialog ref="dialog" class="replay-library" aria-labelledby="replay-library-title">
      <header>
        <h2 id="replay-library-title">回放库</h2>
        <button class="close-library" type="button" aria-label="关闭回放库" @click="dialog?.close()">×</button>
      </header>
      <section v-if="current || bundled" class="current-replay">
        <label>当前回放名称<input v-model="name" maxlength="120" /></label>
        <div class="library-actions">
          <button type="button" :disabled="busy || !duration" @click="useCurrent(false)">保存当前回放</button>
          <button type="button" :disabled="busy || !duration" @click="useCurrent(true)">导出当前回放</button>
        </div>
      </section>
      <p v-if="busy" role="status">正在处理回放…</p>
      <p v-if="error" class="library-error" role="alert">{{ error }}</p>
      <p v-else-if="notice" role="status">{{ notice }}</p>
      <p v-if="!busy && !entries.length && !error">回放库暂无记录。</p>
      <ul v-if="entries.length">
        <li v-for="entry in entries" :key="entry.id">
          <div><strong>{{ entry.name }}</strong><small>{{ dateLabel(entry.createdAt) }} · {{ formatDuration(entry.durationMs) }}</small></div>
          <div class="library-actions">
            <button type="button" :disabled="busy" @click="play(entry)">播放</button>
            <a :href="savedReplayUrl(entry.id)" download>导出</a>
          </div>
        </li>
      </ul>
    </dialog>
  </Teleport>
</template>

<style scoped>
.library-actions { display:flex; align-items:center; flex-wrap:wrap; gap:6px; }
.library-actions button, .library-actions a {
  border:1px solid #b0ccd7; background:#edf6f8; border-radius:7px; color:#155866;
  padding:5px 8px; cursor:pointer; white-space:nowrap; font:inherit; text-decoration:none;
}
.library-actions button:disabled { opacity:.55; cursor:default; }
.library-actions span { font-size:11px; }
.replay-library {
  position:fixed; inset:0; width:min(540px, calc(100% - 28px)); height:fit-content; margin:auto;
  max-height:calc(100dvh - 28px); padding:20px; overflow:auto; border:1px solid #b9ced8;
  border-radius:14px; background:#f8fbfe; color:#173744; box-shadow:0 20px 60px #192f4270;
}
.replay-library::backdrop { background:#0e253a91; }
header, li { display:flex; justify-content:space-between; align-items:center; gap:10px; }
h2 { font-size:21px; }
.close-library { background:transparent; border:0; font-size:26px; cursor:pointer; }
.current-replay { padding:10px 0 14px; }
label { display:grid; gap:5px; font-size:13px; margin-bottom:8px; }
input { padding:7px 8px; border:1px solid #b0ccd7; border-radius:7px; font:inherit; color:inherit; }
p { margin:8px 0; }
.library-error { color:#8f2525; }
ul { padding:0; list-style:none; margin:5px 0; }
li { padding:10px 0; border-top:1px solid #d9e6eb; }
li > div:first-child { min-width:0; overflow-wrap:anywhere; }
small { display:block; color:#526d7b; }
</style>
