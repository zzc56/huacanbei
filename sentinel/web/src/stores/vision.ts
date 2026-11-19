import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type { VisionFrame, VisionStatus } from '@/types';
import { COPY } from '@/types';
import { getTransport, getMockTransport } from '@/data/transport';

export const useVisionStore = defineStore('vision', () => {
  const transport = getTransport();
  const sourceKind = ref<'rtsp' | 'camera' | 'file' | 'image'>('file');
  const sourceAddress = ref('/data/samples/intersection_daylight_720p.mp4');
  const saveDir = ref('/data/vision');
  const confidence = ref(0.50);
  const maxFps = ref(5);

  const status = ref<VisionStatus>({
    state: 'stopped',
    message: COPY.VISION_STOPPED,
    sessionDirectory: null,
    running: false,
    recording: false
  });

  const currentFrame = ref<VisionFrame | null>(null);
  const initialized = ref(false);

  function init(): void {
    if (initialized.value) return;
    initialized.value = true;
    transport.onVisionStatus((s) => {
      status.value = s;
    });
    transport.onVisionFrame((f) => {
      currentFrame.value = f;
    });
  }

  const sourceHint = computed(() => {
    switch (sourceKind.value) {
      case 'rtsp':
        return COPY.HINT_RTSP;
      case 'camera':
        return COPY.HINT_CAMERA;
      case 'image':
        return COPY.HINT_IMAGE;
      case 'file':
      default:
        return COPY.HINT_FILE;
    }
  });

  const visibleBoxes = computed(() => {
    if (!currentFrame.value) return [];
    return currentFrame.value.boxes.filter((b) => b.score >= confidence.value);
  });

  const personCount = computed(() => visibleBoxes.value.filter((b) => b.classId === 0).length);
  const vehicleCount = computed(() => visibleBoxes.value.filter((b) => b.classId !== 0).length);

  async function startDetection(): Promise<void> {
    await transport.visionStart({
      sourceKind: sourceKind.value,
      source: sourceAddress.value,
      confidence: confidence.value,
      maxFps: maxFps.value
    });
  }

  async function stopDetection(): Promise<void> {
    await transport.visionStop();
    currentFrame.value = null;
  }

  async function loadOfflineExample(): Promise<void> {
    const mock = getMockTransport();
    if (mock) {
      await mock.visionLoadOfflineSample(confidence.value);
    } else {
      await startDetection();
    }
  }

  async function startRecording(): Promise<void> {
    await transport.visionStartRecording(saveDir.value);
  }

  async function stopRecording(): Promise<void> {
    await transport.visionStopRecording();
  }

  return {
    sourceKind,
    sourceAddress,
    saveDir,
    confidence,
    maxFps,
    status,
    currentFrame,
    sourceHint,
    visibleBoxes,
    personCount,
    vehicleCount,
    init,
    startDetection,
    stopDetection,
    loadOfflineExample,
    startRecording,
    stopRecording
  };
});
