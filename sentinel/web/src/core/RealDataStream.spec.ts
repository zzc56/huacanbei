import { expect, it, vi } from 'vitest';
import { ApiStream } from './RealDataStream';

it('seeks while paused and applies the new HTTP replay rate without jumping', async () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'performance'] });
  vi.stubGlobal('window', { location: { href: 'http://127.0.0.1:4173/' } });
  const positions: string[] = [];
  vi.stubGlobal('fetch', async (url: URL) => {
    const timeMs = url.searchParams.get('timeMs')!;
    positions.push(timeMs);
    return Response.json({ type: 'recorded_frame', timestamp: 100000 + Number(timeMs),
      replay: { positionMs: Number(timeMs), durationMs: 10000 } });
  });
  const stream = new ApiStream('http://127.0.0.1:3002/api/replay/frame');
  const onFrame = vi.fn();
  try {
    stream.setPaused(true);
    stream.start(onFrame, vi.fn());
    await vi.advanceTimersByTimeAsync(200);
    expect(positions).toEqual(['0']);
    stream.seek(6500);
    await vi.advanceTimersByTimeAsync(500);
    expect(positions).toEqual(['0', '6500']);
    expect(onFrame).toHaveBeenCalledTimes(2);
    expect(onFrame.mock.lastCall?.[0].replay.positionMs).toBe(6500);
    stream.setPlaybackRate(2);
    stream.setPaused(false);
    await vi.advanceTimersByTimeAsync(200);
    expect(positions.slice(-2)).toEqual(['6700', '6900']);
    stream.setPlaybackRate(0.5);
    await vi.advanceTimersByTimeAsync(200);
    expect(positions.slice(-2)).toEqual(['6950', '7000']);
  } finally {
    stream.dispose();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  }
});
