import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type { HostStatus, RadarTarget } from '@/types';
import { COPY } from '@/types';
import { getTransport } from '@/data/transport';
import { truncateLogBuffer, formatTimeHms } from '@/utils/format';

export const useRadarStore = defineStore('radar', () => {
  const transport = getTransport();
  const host = ref('192.168.10.123');
  const port = ref(50000);
  const saveDir = ref('/data');
  const viewHalfWidth = ref(20);
  const viewLength = ref(100);

  const status = ref<HostStatus>({
    state: 'Disconnected',
    message: COPY.LOG_DISCONNECTED,
    sessionDirectory: null,
    sourceKind: null,
    connected: false,
    recording: false,
    bytesReceived: 0,
    targetCount: 0,
    messageCount: 0,
    lastReceiveUtc: null
  });

  const targets = ref<RadarTarget[]>([]);
  const logText = ref(`${formatTimeHms(new Date())}  ${COPY.LOG_DISCONNECTED}`);
  const initialized = ref(false);

  function init(): void {
    if (initialized.value) return;
    initialized.value = true;
    transport.onRadarStatus((s) => {
      status.value = s;
    });
    transport.onRadarTargets((list) => {
      // Strictly cap at 128 rows per specification
      targets.value = list.slice(0, 128);
    });
    transport.onRadarLog((line) => {
      const combined = logText.value ? `${logText.value}\n${line}` : line;
      logText.value = truncateLogBuffer(combined, 24000, 12000);
    });
  }

  function appendLog(msg: string): void {
    const line = `${formatTimeHms(new Date())}  ${msg}`;
    const combined = logText.value ? `${logText.value}\n${line}` : line;
    logText.value = truncateLogBuffer(combined, 24000, 12000);
  }

  const canConnect = computed(() => !status.value.connected && status.value.state !== 'Replay' && status.value.state !== 'Connecting');
  const canDisconnect = computed(() => status.value.connected || status.value.state === 'Replay');
  const inputsDisabled = computed(() => status.value.connected || status.value.state === 'Replay' || status.value.state === 'Connecting');

  async function connect(): Promise<void> {
    const validPort = Math.max(1, Math.min(65535, Math.round(port.value)));
    port.value = validPort;
    await transport.radarConnect(host.value, validPort);
  }

  async function disconnect(): Promise<void> {
    targets.value = [];
    await transport.radarDisconnect();
  }

  async function startRecording(): Promise<void> {
    if (!status.value.connected) return;
    await transport.radarStartRecording(saveDir.value);
  }

  async function stopRecording(): Promise<void> {
    await transport.radarStopRecording();
  }

  async function startReplay(synthetic = false): Promise<void> {
    const dir = synthetic ? `${saveDir.value}/synthetic_self_test_20261013` : `${saveDir.value}/tcr300_capture_20261013`;
    await transport.radarReplay(dir);
  }

  async function stopReplay(): Promise<void> {
    targets.value = [];
    await transport.radarStopReplay();
  }

  return {
    host,
    port,
    saveDir,
    viewHalfWidth,
    viewLength,
    status,
    targets,
    logText,
    canConnect,
    canDisconnect,
    inputsDisabled,
    init,
    appendLog,
    connect,
    disconnect,
    startRecording,
    stopRecording,
    startReplay,
    stopReplay
  };
});
