import { onBeforeUnmount, ref, shallowRef, watch } from 'vue';
import { encodeReplayPacket, replaySnapshot, replayMaximumSize } from '../data/replayArchive';
import type { ImageReplay, ReplayPacket } from '../data/bundledReplay';
import type { Frame } from '../types';
import { useSceneStore } from '../stores/scene';

type Session = {
  name: string;
  started: number;
  packets: ReplayPacket[];
  images: Map<number, Blob>;
  imageRequest?: Promise<void>;
  imageBytes: number;
  estimatedDataBytes: number;
};

export function useReplayRecorder(onFinish: (recording: ImageReplay) => Promise<void>) {
  const store = useSceneStore();
  const utf8 = new TextEncoder();
  const capacity = replayMaximumSize - 6 * 1024 * 1024;
  const recording = ref(false);
  const elapsedMs = ref(0);
  const draft = shallowRef<ImageReplay>();
  let session: Session | undefined;

  function capture(frame: Frame) {
    const active = session;
    if (!active || frame.source !== 'live') return;
    const camera = frame.cameraFrame;
    const pts = active.packets.length ? performance.now() - active.started : 0;
    if (active.packets.length && pts - active.packets.at(-1)!.pts < 95) return;
    if (!camera?.imageUrl && frame.live?.radar.state !== 'streaming') return;
    const packet = { pts, frame: replaySnapshot(frame) };
    const bytes = utf8.encode(encodeReplayPacket(packet)).length + 1 + frame.targets.length * 512;
    if (active.estimatedDataBytes + active.imageBytes + bytes > capacity) {
      void stop();
      return;
    }
    active.packets.push(packet);
    active.estimatedDataBytes += bytes;
    elapsedMs.value = pts;
    if (!camera?.imageUrl || active.images.has(camera.sequence) || active.imageRequest) return;
    active.imageRequest = fetch(camera.imageUrl, { signal: AbortSignal.timeout(1500) })
      .then(async response => {
        if (!response.ok) return;
        const image = await response.blob();
        if (image.size && active.imageBytes + active.estimatedDataBytes + image.size <= capacity && image.type.startsWith('image/')) {
          active.images.set(camera.sequence, image);
          active.imageBytes += image.size;
        }
      })
      .catch(() => { /* Radar and detection data still belong to this recorded frame. */ })
      .finally(() => { active.imageRequest = undefined; });
  }

  function start(name: string) {
    if (recording.value || draft.value) return;
    session = { name, started: performance.now(), packets: [], images: new Map(), imageBytes: 0, estimatedDataBytes: 0 };
    elapsedMs.value = 0;
    recording.value = true;
    capture(store.frame);
  }

  async function stop() {
    const active = session;
    if (!active) return;
    session = undefined;
    const durationMs = Math.max(100, Math.round(performance.now() - active.started));
    if (active.imageRequest) await active.imageRequest;
    recording.value = false;
    if (!active.packets.length) return;
    draft.value = { name: active.name, durationMs, packets: active.packets.reverse(), images: active.images };
    await onFinish(draft.value);
  }

  watch(() => store.frame, capture, { flush: 'sync' });
  watch(() => store.playing && store.connection === 'connected', ready => {
    if (!ready && session) void stop();
  });
  const protect = (event: BeforeUnloadEvent) => {
    if (recording.value || draft.value) { event.preventDefault(); event.returnValue = ''; }
  };
  window.addEventListener('beforeunload', protect);
  onBeforeUnmount(() => {
    session = undefined;
    window.removeEventListener('beforeunload', protect);
  });
  return { recording, elapsedMs, draft, start, stop };
}
