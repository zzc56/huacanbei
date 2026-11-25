import { onMounted, onUnmounted, shallowRef, ref, watch } from 'vue';
import { useSceneStore } from '../stores/scene';
import { createStream, type MonitorSource } from '../services/stream';
import { interpolateTargets } from '../core/fusion';
import type { DataStream, Target } from '../types';
import type { ReplayRecording } from '../data/bundledReplay';

export function useScene(configuration: () => {
  source: MonitorSource;
  bundledReplay?: boolean;
  imported?: ReplayRecording;
}) {
  const store = useSceneStore();
  const renderTargets = shallowRef<Target[]>([]);
  const time = ref(0);
  let old: Target[] = [],
    current: Target[] = [],
    receivedAt = 0,
    raf = 0,
    last = 0,
    nextRender = 0,
    sampleAt = 0,
    count = 0,
    pausedAt = 0;
  let active: DataStream | undefined;
  let stopStream: (() => void) | undefined;
  const stopSelection = watch(() => store.selectedId, id => active?.select?.(id));
  const stopSeek = watch(() => store.seekRequest, request => { if(request) active?.seek?.(request.positionMs); });
  const stopRate = watch(() => store.replayPlaybackRate, rate => {
    if (store.frame.source === 'recording') active?.setPlaybackRate?.(rate);
  });
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const stopWatch = watch(
    () => store.playing,
    (value) => {
      active?.setPaused(!value);
      if (!value) pausedAt = performance.now();
      else {
        if (receivedAt) receivedAt += performance.now() - pausedAt;
        last = performance.now();
      }
    },
  );
  function animate(now: number) {
    if (now < nextRender - 0.7) {
      raf = requestAnimationFrame(animate);
      return;
    }
    nextRender = Math.max(nextRender + 1000 / 60, now);
    const delta = last ? Math.min(0.1, (now - last) / 1000) : 0;
    last = now;
    if (store.playing) {
      time.value += delta;
      renderTargets.value = store.connection !== 'mock' || reducedMotion.matches
        ? current
        : interpolateTargets(old, current, Math.min(1, (now - receivedAt) / 100));
    }
    count++;
    if (now - sampleAt >= 1000) {
      store.fps = Math.round((count * 1000) / (now - sampleAt));
      count = 0;
      sampleAt = now;
    }
    raf = requestAnimationFrame(animate);
  }
  function startStream({ source, bundledReplay, imported }: ReturnType<typeof configuration>) {
    const previous = active;
    const stream = active = createStream(source, bundledReplay, imported);
    previous?.dispose();
    old = [];
    current = [];
    receivedAt = 0;
    pausedAt = 0;
    renderTargets.value = [];
    time.value = 0;
    store.replayVideo = stream.replayVideo ?? null;
    store.imageReplay = !!(imported && 'images' in imported);
    store.replayRiskHistory = undefined;
    store.frame = { timestamp: 0, targets: [], source };
    store.connection = 'connecting';
    store.playing = source === 'live';
    stream.setPaused(!store.playing);
    if (source === 'recording') stream.setPlaybackRate?.(store.replayPlaybackRate);
    store.select('—');
    store.seekRequest = null;
    store.cameraLatencyMs = null;
    store.latency = 0;
    store.fps = 0;
    stream.start(
      (frame) => {
        if (active !== stream) return;
        const selectedTrackId = store.selected?.camera?.trackId;
        old = renderTargets.value.length ? renderTargets.value : frame.targets;
        current = frame.targets.map((t) => ({ ...t, history: t.history ?? [] }));
        receivedAt = performance.now();
        store.frame = { ...frame, targets: current };
        store.replayRiskHistory = stream.replayRiskHistory;
        if (!current.some((t) => t.id === store.selectedId)) {
          const continued = selectedTrackId && current.find((target) => target.camera?.trackId === selectedTrackId);
          if (continued) store.select(continued.id);
          else store.select(current[0]?.id ?? '—');
        }
        store.keepReplayRiskSelection();
        if (frame.source !== 'mock' || !renderTargets.value.length) renderTargets.value = current;
        // Mock 的时间戳为仿真时间，延迟不可当作真实网络延迟。
        store.latency = frame.source === 'recording' || store.connection === 'mock' ? 0 : Math.max(0, Date.now() - frame.timestamp);
      },
      (state) => {
        if (active !== stream) return;
        store.connection = state;
        if(store.frame.source==='live' && ['disconnected','error','connecting'].includes(state)){
          current=[];old=[];renderTargets.value=[];
          store.frame={...store.frame,timestamp:Date.now(),targets:[],riskField:undefined,cameraFrame:undefined,
            ...(store.frame.live?{live:{...store.frame.live,radar:{...store.frame.live.radar,state:'disconnected'},
              camera:{state:'disconnected',message:'实时连接已断开，等待恢复摄像头数据'},
              association:{state:'waiting',message:'等待实时连接恢复'},
              fusion:{state:'unavailable',message:'实时连接已断开，等待恢复雷达数据'}}}:{})};
        }
      },
      playing => { if (active === stream) store.playing = playing; },
    );
  }
  onMounted(() => {
    sampleAt = performance.now();
    stopStream = watch(configuration, startStream, { immediate: true });
    raf = requestAnimationFrame(animate);
  });
  onUnmounted(() => {
    cancelAnimationFrame(raf);
    stopStream?.();
    const stream = active;
    active = undefined;
    stream?.dispose();
    if (store.replayVideo === stream?.replayVideo) store.replayVideo = null;
    if (store.replayRiskHistory === stream?.replayRiskHistory) store.replayRiskHistory = undefined;
    stopWatch();
    stopSelection(); stopSeek(); stopRate();
  });
  return { renderTargets, time };
}
