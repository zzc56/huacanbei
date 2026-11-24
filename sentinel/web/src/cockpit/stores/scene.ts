import { computed, ref, shallowRef } from 'vue';
import { defineStore } from 'pinia';
import type { ConnectionState, DataStream, Frame, RiskTrendPoint, VideoSource } from '../types';
import { riskParams } from '../core/risk';
export const useSceneStore = defineStore('cockpit', () => {
  const frame = shallowRef<Frame>({ timestamp: 0, targets: [] });
  const selectedId = ref('T005');
  const seekRequest = ref<{ positionMs: number; token: number } | null>(null);
  const imageReplay = ref(false);
  const replayVideo = shallowRef<HTMLVideoElement | null>(null);
  const replayRiskHistory = shallowRef<ReadonlyMap<string, RiskTrendPoint[]>>();
  const playing = ref(true);
  const connection = ref<ConnectionState>('connecting');
  const liveCameraReady = computed(() =>
    connection.value === 'connected' && frame.value.source === 'live' &&
    frame.value.live?.camera.state === 'streaming' && !!frame.value.cameraFrame?.imageUrl,
  );
  const fps = ref(0);
  const latency = ref(0);
  const cameraLatencyMs = ref<number|null>(null);
  const videoSource = ref<VideoSource>({ type: 'mock' });
  const selected = computed(() => frame.value.targets.find((t) => t.id === selectedId.value));
  const usesRadarMeasurements = computed(() => frame.value.source === 'recording' || frame.value.source === 'live');
  const selectedMeasurement = computed(() =>
    usesRadarMeasurements.value && !selected.value?.radar ? undefined : selected.value,
  );
  const riskTargets = computed(() =>
    usesRadarMeasurements.value ? frame.value.targets.filter(target => target.radar) : frame.value.targets,
  );
  const knownRiskTargets = computed(() => riskTargets.value.filter(t => t.risk !== undefined));
  const averageRisk = computed(() => knownRiskTargets.value.length ? knownRiskTargets.value.reduce((sum,t)=>sum+t.risk!.value,0)/knownRiskTargets.value.length : null);
  const maximumRisk = computed(() => knownRiskTargets.value.length ? Math.max(...knownRiskTargets.value.map(t=>t.risk!.value)) : null);
  const alerts = computed(
    () => knownRiskTargets.value.filter((t) => t.risk!.value >= riskParams.threshold).length,
  );
  function select(id: string) {
    selectedId.value = id;
  }
  function keepReplayRiskSelection() {
    if (frame.value.source !== 'recording' || !playing.value || selectedMeasurement.value?.risk) return;
    const replacement = [...knownRiskTargets.value].sort((a, b) =>
      Number(!!b.camera) - Number(!!a.camera) || b.risk!.value - a.risk!.value,
    )[0];
    if (replacement) select(replacement.id);
  }
  function seek(positionMs: number) { seekRequest.value = { positionMs, token: performance.now() }; }
  return {
    frame,
    selectedId,
    playing,
    connection,
    liveCameraReady,
    fps,
    latency,
    cameraLatencyMs,
    videoSource,
    selected, selectedMeasurement, usesRadarMeasurements, riskTargets,
    averageRisk,
    maximumRisk,
    alerts,
    select, keepReplayRiskSelection,
    knownRiskTargets, replayVideo, imageReplay, replayRiskHistory, seekRequest, seek,
  };
});
