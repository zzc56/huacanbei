import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { CalibrationPoint, FusionConfig, FusionSnapshot } from '@/types';
import { COPY } from '@/types';
import { getTransport, getMockTransport } from '@/data/transport';
import { DEFAULT_CALIBRATION_POINTS } from '@/utils/calibration';
import type { FusionDemoMode } from '@/data/mock/fusionSim';

export const useFusionStore = defineStore('fusion', () => {
  const transport = getTransport();
  const saveDir = ref('/data/fusion');
  const recording = ref(false);
  const sessionDirectory = ref<string | null>(null);
  const showCalibrationBoundary = ref(true);
  const hintMessage = ref<string>(COPY.FUSION_CALIBRATED);
  const snapshot = ref<FusionSnapshot | null>(null);
  const initialized = ref(false);

  const xHalfWidth = ref(20);
  const yMax = ref(60);
  const alignWindowMs = ref(500);
  const cameraOffsetMs = ref(0);
  const extendRadarField = ref(true);

  function init(): void {
    if (initialized.value) return;
    initialized.value = true;
    transport.onFusionSnapshot((s) => {
      snapshot.value = s;
    });
  }

  async function applyParams(): Promise<void> {
    hintMessage.value = COPY.FUSION_PARAM_PENDING;
    const cfg: Partial<FusionConfig> = {
      xMin: -Math.abs(xHalfWidth.value),
      xMax: Math.abs(xHalfWidth.value),
      yMin: 0,
      yMax: yMax.value,
      alignWindowMs: alignWindowMs.value,
      cameraOffsetMs: cameraOffsetMs.value,
      extendRadarField: extendRadarField.value
    };
    await transport.fusionSetConfig(cfg);
    hintMessage.value = COPY.FUSION_GENERATION_CHANGED;
  }

  async function applyCalibration(points: CalibrationPoint[] = DEFAULT_CALIBRATION_POINTS): Promise<void> {
    const ok = await transport.fusionCalibrate(points);
    hintMessage.value = ok ? COPY.FUSION_CALIBRATED : COPY.FUSION_EMPTY;
  }

  async function clearCalibration(): Promise<void> {
    await transport.fusionCalibrate([]);
    hintMessage.value = COPY.FUSION_EMPTY;
  }

  function setDemoState(mode: FusionDemoMode): void {
    const mock = getMockTransport();
    if (mock) {
      mock.setFusionDemoMode(mode);
      if (mode === 'ok') hintMessage.value = COPY.FUSION_CALIBRATED;
      if (mode === 'expired') hintMessage.value = COPY.FUSION_EXPIRED;
      if (mode === 'uncalibrated') hintMessage.value = COPY.FUSION_EMPTY;
    }
  }

  async function startRecording(): Promise<void> {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    sessionDirectory.value = `${saveDir.value.replace(/\/$/, '')}/fusion_session_${stamp}`;
    recording.value = true;
    await transport.fusionStartRecording(saveDir.value);
  }

  async function stopRecording(): Promise<void> {
    recording.value = false;
    await transport.fusionStopRecording();
  }

  return {
    saveDir,
    recording,
    sessionDirectory,
    showCalibrationBoundary,
    hintMessage,
    snapshot,
    xHalfWidth,
    yMax,
    alignWindowMs,
    cameraOffsetMs,
    extendRadarField,
    init,
    applyParams,
    applyCalibration,
    clearCalibration,
    setDemoState,
    startRecording,
    stopRecording
  };
});
