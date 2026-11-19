import { onMounted, onUnmounted, shallowRef, ref, watch } from 'vue';
import { useSceneStore } from '../stores/scene';
import { createStream } from '../services/stream';
import { interpolateTargets } from '../core/fusion';
import type { Target } from '../types';
export function useScene() {
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
  const stream = createStream();
  const stopSelection = watch(() => store.selectedId, id => stream.select?.(id));
  const stopSeek = watch(() => store.seekRequest, request => { if(request) stream.seek?.(request.positionMs); });
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const stopWatch = watch(
    () => store.playing,
    (value) => {
      stream.setPaused(!value);
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
  onMounted(() => {
    sampleAt = performance.now();
    // 重新进入驾驶舱或热更新时，沿用用户的暂停状态。
    stream.setPaused(!store.playing);
    stream.start(
      (frame) => {
        old = renderTargets.value.length ? renderTargets.value : frame.targets;
        current = frame.targets.map((t) => ({ ...t, history: t.history ?? [] }));
        receivedAt = performance.now();
        store.frame = { ...frame, targets: current };
        if (!current.some((t) => t.id === store.selectedId)) store.select(current[0]?.id ?? '—');
        if (frame.source !== 'mock' || !renderTargets.value.length) renderTargets.value = current;
        // Mock 的时间戳为仿真时间，延迟不可当作真实网络延迟。
        store.latency = frame.source === 'recording' || store.connection === 'mock' ? 0 : Math.max(0, Date.now() - frame.timestamp);
      },
      (state) => {
        store.connection = state;
        if(store.frame.source==='live' && ['disconnected','error','connecting'].includes(state)){
          current=[];old=[];renderTargets.value=[];
          store.frame={...store.frame,timestamp:Date.now(),targets:[],riskField:undefined,cameraFrame:undefined,
            ...(store.frame.live?{live:{...store.frame.live,radar:{...store.frame.live.radar,state:'disconnected'},
              fusion:{state:'unavailable',message:'实时连接已断开，等待恢复雷达数据'}}}:{})};
        }
      },
      playing => { store.playing = playing; },
    );
    raf = requestAnimationFrame(animate);
  });
  onUnmounted(() => {
    cancelAnimationFrame(raf);
    stream.dispose();
    stopWatch();
    stopSelection(); stopSeek();
  });
  return { renderTargets, time };
}
