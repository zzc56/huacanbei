import type { DataStream } from '../types';
import { indexReplayRiskHistory, type ImageReplay } from './bundledReplay';

export class ImageReplayStream implements DataStream {
  readonly replayRiskHistory;
  private readonly urls = new Map<number, string>();
  private anchor = 0;
  private position = 0;
  private rate = 1;
  private paused = true;
  private raf = 0;
  private onFrame?: Parameters<DataStream['start']>[0];
  private onPlayback?: Parameters<DataStream['start']>[2];
  private lastStep = -1;
  private lastIndex = -1;

  constructor(private readonly replay: ImageReplay) {
    this.replayRiskHistory = indexReplayRiskHistory(replay.packets);
  }

  start(onFrame: Parameters<DataStream['start']>[0], onStatus: Parameters<DataStream['start']>[1], onPlayback?: Parameters<DataStream['start']>[2]) {
    this.onFrame = onFrame;
    this.onPlayback = onPlayback;
    onStatus('replay');
    this.publish(true);
  }

  private publish(force = false) {
    const { packets, durationMs, images } = this.replay;
    let low = 0, high = packets.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (packets[middle].pts > this.position) low = middle + 1;
      else high = middle;
    }
    const step = Math.floor(this.position / 100);
    if (!force && low === this.lastIndex && step === this.lastStep) return;
    this.lastIndex = low;
    this.lastStep = step;
    const frame = packets[low]?.frame;
    const camera = frame?.cameraFrame;
    let url = camera && this.urls.get(camera.sequence);
    const image = camera && images.get(camera.sequence);
    if (camera && image && !url) {
      url = URL.createObjectURL(image);
      this.urls.set(camera.sequence, url);
    }
    this.onFrame?.({
      ...(frame ?? { timestamp: 0, targets: [] }), source: 'recording',
      cameraFrame: camera && url ? { ...camera, imageUrl: url } : undefined,
      replay: { positionMs: this.position, durationMs, ended: this.position >= durationMs },
    });
  }

  private advance(now: number) {
    this.position = Math.min(this.replay.durationMs, this.position + Math.max(0, now - this.anchor) * this.rate);
    this.anchor = now;
  }

  private tick = (now: number) => {
    this.advance(now);
    this.publish(this.position >= this.replay.durationMs);
    if (this.position >= this.replay.durationMs) {
      this.paused = true;
      this.onPlayback?.(false);
    } else if (!this.paused) this.raf = requestAnimationFrame(this.tick);
  };

  setPaused(paused: boolean) {
    if (paused === this.paused) return;
    this.paused = paused;
    if (paused) {
      this.advance(performance.now());
      cancelAnimationFrame(this.raf);
      this.publish(true);
      return;
    }
    if (this.position >= this.replay.durationMs) this.seek(0);
    this.anchor = performance.now();
    this.raf = requestAnimationFrame(this.tick);
  }

  setPlaybackRate(rate: number) {
    if (!this.paused) this.advance(performance.now());
    this.rate = rate;
  }

  seek(positionMs: number) {
    if (!Number.isFinite(positionMs)) return;
    this.position = Math.max(0, Math.min(positionMs, this.replay.durationMs));
    this.anchor = performance.now();
    this.publish(true);
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    for (const url of this.urls.values()) URL.revokeObjectURL(url);
    this.urls.clear();
  }
}
