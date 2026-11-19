import type { ConnectionState, DataStream, Frame, Target } from '../types';
import { projectCamera, solveFusion } from '../core/fusion';

const seeds = [
  [-32, 106, 0.32, 'car', 'fused'],
  [-116, 42, 0.18, 'car', 'radar'],
  [42, 138, 0.58, 'truck', 'fused'],
  [-8, 170, 0.23, 'car', 'fused'],
  [14, 53, 0.87, 'car', 'fused'],
  [88, -92, 0.21, 'car', 'radar'],
  [-8, 83, 0.46, 'car', 'fused'],
  [98, 88, 0.28, 'person', 'vision'],
] as const;
export function mockFrame(time: number): Frame {
  const targets: Target[] = seeds.map(([x0, y0, risk, category, mode], i) => {
    const w = 0.07 + i * 0.006,
      phase = time * w + i;
    const x = x0 + Math.sin(phase) * 7,
      y = y0 + 40 * (Math.sin(i * 0.12) - Math.sin(time * 0.18 + i * 0.12));
    // 速度严格取轨迹对时间的导数，位置、速度及风险预测共用同一运动模型。
    const vx = Math.cos(phase) * 7 * w,
      vy = -7.2 * Math.cos(time * 0.18 + i * 0.12);
    const f = solveFusion(x, y, vx, vy);
    const value = Math.min(
      0.99,
      Math.max(
        0,
        risk * (0.825 + 0.175 * Math.cos(time / 190)) + Math.sin(time * 0.16 + i) * 0.025,
      ),
    );
    return {
      id: `T${String(i + 1).padStart(3, '0')}`,
      fusion: f,
      radar:
        mode === 'vision'
          ? undefined
          : {
              range: Math.hypot(x, y),
              azimuth: f.azimuth,
              radialVelocity: f.radialVelocity,
              rcs: 0.72 + i * 0.025,
            },
      camera:
        mode === 'radar'
          ? undefined
          : {
              bbox: projectCamera(x, y, category === 'truck', category === 'person'),
              class: category,
              confidence: 0.98 - i * 0.013,
            },
      risk: { value, level: value >= 0.75 ? 'high' : value >= 0.4 ? 'mid' : 'low' },
      history: Array.from({ length: 15 }, (_, k) => {
        const past = time - k * 0.4;
        return {
          x: x0 + Math.sin(past * w + i) * 7,
          y: y0 + 40 * (Math.sin(i * 0.12) - Math.sin(past * 0.18 + i * 0.12)),
        };
      }),
    };
  });
  return { timestamp: time * 1000, targets, source: 'mock' };
}
export class MockStream implements DataStream {
  private timer?: ReturnType<typeof setInterval>;
  private time = 0;
  private paused = false;
  start(onFrame: (frame: Frame) => void, status: (s: ConnectionState) => void) {
    status('mock');
    onFrame(mockFrame(0));
    this.timer = setInterval(() => {
      if (!this.paused) {
        this.time += 0.1;
        onFrame(mockFrame(this.time));
      }
    }, 100);
  }
  setPaused(value: boolean) {
    this.paused = value;
  }
  dispose() {
    clearInterval(this.timer);
  }
}
/** Explicit mock mode only. The default path is the measured recording service. */
export { WebSocketStream, ApiStream } from '../../core/RealDataStream';
import { WebSocketStream, ApiStream } from '../../core/RealDataStream';
export function createStream(): DataStream {
  const env = import.meta.env;
  if (env.VITE_STREAM_MODE === 'mock') return new MockStream();
  if (env.VITE_STREAM_MODE === 'api') return new ApiStream(env.VITE_STREAM_URL || 'http://127.0.0.1:3001/api/replay/frame');
  return new WebSocketStream(env.VITE_STREAM_URL || 'ws://127.0.0.1:3001/stream');
}
