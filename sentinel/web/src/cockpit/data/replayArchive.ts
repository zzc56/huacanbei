import type { Frame, ScalarField } from '../types';
import type { ReplayRecording, ReplayPacket } from './bundledReplay';
import { readZip, writeZip } from './zip';

export const replayMaximumSize = 256 * 1024 * 1024;
type ArchiveField = Omit<ScalarField, 'values' | 'valid' | 'calibrated'> & {
  values: (number | null)[]; valid: number[]; calibrated?: number[];
};
type ArchivePacket = { pts: number; frame: Omit<Frame, 'riskField'> & { riskField?: ArchiveField } };

function archiveField(field: ScalarField | undefined): ArchiveField | undefined {
  if (!field) return;
  return { ...field, values: Array.from(field.values), valid: Array.from(field.valid),
    calibrated: field.calibrated && Array.from(field.calibrated) };
}

function restoreField(field: ArchiveField | undefined): ScalarField | undefined {
  if (!field) return;
  const size = field.width * field.height;
  if (!Number.isInteger(field.width) || field.width < 2 || !Number.isInteger(field.height) || field.height < 2 ||
      size > 262144 || !Array.isArray(field.xAxis) || field.xAxis.length !== field.width ||
      !Array.isArray(field.yAxis) || field.yAxis.length !== field.height ||
      !Array.isArray(field.values) || field.values.length !== size ||
      !Array.isArray(field.valid) || field.valid.length !== size) throw new Error('回放的风险场网格无效。');
  return { ...field, values: Float32Array.from(field.values, value => value ?? NaN),
    valid: Uint8Array.from(field.valid), calibrated: field.calibrated && Uint8Array.from(field.calibrated) };
}

export function replaySnapshot(frame: Frame): Frame {
  const camera = frame.cameraFrame;
  return {
    source: 'recording', timestamp: frame.timestamp, targets: frame.targets,
    cameraFrame: camera && { sequence: camera.sequence, width: camera.width, height: camera.height,
      timestamp: camera.timestamp, annotated: camera.annotated, alignmentDelayMs: camera.alignmentDelayMs },
    riskField: frame.riskField, bounds: frame.bounds, radarRange: frame.radarRange,
    northCalibrated: frame.northCalibrated, recordingCounts: frame.recordingCounts,
    replayAssociation: frame.replayAssociation ?? (frame.live?.association?.state === 'active' ? 'evaluated' : undefined),
    message: frame.message,
  };
}

function targetCsv(packets: ReplayPacket[]) {
  const cell = (value: unknown) => {
    if (value === undefined || value === null) return '';
    if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
    const text = String(value);
    return '"' + (/^[=+\-@\t\r\n]/.test(text) ? "'" : '') + text.replaceAll('"', '""') + '"';
  };
  const lines = ['pts_ms,host_utc,target_id,radar_track,radar_instance,visual_track,visual_class,confidence,x_m,y_m,distance_m,speed_m_s,risk,association'];
  for (const { pts, frame } of [...packets].reverse()) {
    const time = new Date(frame.timestamp).toISOString();
    for (const target of frame.targets) {
      lines.push([Math.round(pts), time, target.id, target.radar ? target.id.replace(/^radar:/, '') : undefined,
        target.trackInstanceId, target.camera?.trackId, target.camera?.class, target.camera?.confidence,
        target.fusion?.x, target.fusion?.y, target.radar?.range, target.fusion?.speed, target.risk?.value,
        target.autoAssociation?.method].map(cell).join(','));
    }
  }
  return new Blob(['\uFEFF', lines.join('\r\n'), '\r\n'], { type: 'text/csv;charset=utf-8' });
}

export function encodeReplayPacket({ pts, frame }: ReplayPacket) {
  return JSON.stringify({ pts, frame: { ...replaySnapshot(frame), riskField: archiveField(frame.riskField) } });
}

export async function encodeReplay(recording: ReplayRecording, name: string, duration: number) {
  const video = 'video' in recording ? recording.video : undefined;
  const videoName = video && (/\.mp4$/i.test(video.name) ? 'recording.mp4' : 'recording.webm');
  const entries = new Map<string, Blob>();
  entries.set('manifest.json', new Blob([JSON.stringify({
    format: 'sentinel-replay', version: 1, name, durationMs: Math.round(duration), video: videoName,
  }, null, 2)]));
  const lines = [...recording.packets].reverse().map(encodeReplayPacket);
  entries.set('measurements.jsonl', new Blob([lines.join('\n') + '\n']));
  entries.set('targets.csv', targetCsv(recording.packets));
  if (video && videoName) entries.set(videoName, video);
  if ('images' in recording) {
    for (const [sequence, file] of recording.images) entries.set(`camera/${sequence}.jpg`, file);
  }
  if ([...entries.values()].reduce((sum, file) => sum + file.size, 0) > replayMaximumSize - 4 * 1024 * 1024) {
    throw new Error('回放文件超过 256 MB。');
  }
  return writeZip(entries);
}

export async function decodeReplay(archive: Blob): Promise<ReplayRecording> {
  if (archive.size > replayMaximumSize) throw new Error('回放文件超过 256 MB。');
  const entries = await readZip(archive);
  const meta = JSON.parse(await entries.get('manifest.json')?.text() ?? 'null');
  const input = entries.get('measurements.jsonl');
  if (meta?.format !== 'sentinel-replay' || meta.version !== 1 || typeof meta.name !== 'string' ||
      !Number.isSafeInteger(meta.durationMs) || meta.durationMs <= 0 || !input) {
    throw new Error('请选择 Sentinel 导出的回放压缩包。');
  }
  const packets: ReplayPacket[] = [];
  let previous = -1;
  for (const line of (await input.text()).trim().split(/\r?\n/)) {
    const { pts, frame } = JSON.parse(line) as ArchivePacket;
    if (!Number.isFinite(pts) || pts < 0 || pts < previous || pts > meta.durationMs + 40 ||
        !frame || !Number.isFinite(frame.timestamp) || !Array.isArray(frame.targets)) throw new Error('回放的时间轴或帧数据无效。');
    previous = pts;
    packets.push({ pts, frame: { ...replaySnapshot({ ...frame, riskField: undefined }), riskField: restoreField(frame.riskField) } });
  }
  packets.reverse();
  if (meta.video === 'recording.mp4' || meta.video === 'recording.webm') {
    const video = entries.get(meta.video);
    if (!video?.size) throw new Error('回放压缩包缺少视频。');
    return { name: meta.name, durationMs: meta.durationMs, packets, video: new File([video], meta.video, {
      type: meta.video.endsWith('mp4') ? 'video/mp4' : 'video/webm',
    }) };
  }
  const images = new Map<number, Blob>();
  for (const [name, value] of entries) {
    const sequence = /^camera\/(\d+)\.jpg$/.exec(name);
    if (sequence) images.set(Number(sequence[1]), value.slice(0, value.size, 'image/jpeg'));
  }
  return { name: meta.name, durationMs: meta.durationMs, packets, images };
}

export type ReplayEntry = { id: string; name: string; createdAt: number; durationMs: number };
const api = '/api/replays';

async function request(path: string, options?: RequestInit) {
  const response = await fetch(api + path, options);
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message ?? '回放库访问失败，请检查本地服务。');
  }
  return response;
}

export async function listSavedReplays(): Promise<ReplayEntry[]> {
  return (await request('')).json();
}
export async function saveReplay(name: string, durationMs: number, archive: Blob): Promise<ReplayEntry> {
  const query = new URLSearchParams({ name, durationMs: String(Math.round(durationMs)) });
  return (await request(`?${query}`, { method: 'POST', body: archive })).json();
}
export function savedReplayUrl(id: string) { return `${api}/${encodeURIComponent(id)}`; }
export async function openSavedReplay(id: string) {
  return decodeReplay(await (await request(`/${encodeURIComponent(id)}`)).blob());
}

export function downloadReplay(file: Blob, name: string) {
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${name.replace(/[\\/:*?"<>|]/g, '_')}.zip`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
