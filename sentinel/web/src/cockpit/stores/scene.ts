import { computed, ref, shallowRef } from 'vue';
import { defineStore } from 'pinia';
import type { ConnectionState, Frame, VideoSource } from '../types';
import { riskParams } from '../core/risk';
export const useSceneStore = defineStore('cockpit', () => {
  const frame = shallowRef<Frame>({ timestamp: 0, targets: [] });
  const selectedId = ref('T005');
  const seekRequest = ref<{ positionMs: number; token: number } | null>(null);
  const playing = ref(true);
  const connection = ref<ConnectionState>('connecting');
  const fps = ref(0);
  const latency = ref(0);
  const cameraLatencyMs = ref<number|null>(null);
  const videoSource = ref<VideoSource>({ type: 'mock' });
  const selected = computed(() => frame.value.targets.find((t) => t.id === selectedId.value));
  const knownRiskTargets = computed(() => frame.value.targets.filter(t => t.risk !== undefined));
  const averageRisk = computed(() => knownRiskTargets.value.length ? knownRiskTargets.value.reduce((sum,t)=>sum+t.risk!.value,0)/knownRiskTargets.value.length : null);
  const maximumRisk = computed(() => knownRiskTargets.value.length ? Math.max(...knownRiskTargets.value.map(t=>t.risk!.value)) : null);
  const alerts = computed(
    () => frame.value.targets.filter((t) => (t.risk?.value ?? 0) >= riskParams.threshold).length,
  );
  function select(id: string) {
    selectedId.value = id;
  }
  function seek(positionMs: number) { seekRequest.value = { positionMs, token: performance.now() }; }
  return {
    frame,
    selectedId,
    playing,
    connection,
    fps,
    latency,
    cameraLatencyMs,
    videoSource,
    selected,
    averageRisk,
    maximumRisk,
    alerts,
    select,
    knownRiskTargets, seekRequest, seek,
  };
});
