import { describe, expect, it } from 'vitest';
import type { Frame, Target } from '../types';
import { confidentRadarPairs, RadarCandidateTracker, radarCandidateConfidence } from './radarCandidates';

function capturedFrame(step: number, tracks: string[], withRadar = true): Frame {
  const timestamp = 1_000_000 + step * 100;
  const imageTime = timestamp - 300;
  const visualHeight = (25 + Math.max(0, step - 3) * 2) / 448;
  const radarTargets: Target[] = withRadar ? [
    { id: 'radar:41', observationTimestamp: timestamp, radar: { range: 3000 / (25 + step * 2), azimuth: 0, radialVelocity: -5 } },
    { id: 'radar:42', observationTimestamp: timestamp, radar: { range: 40 + step, azimuth: 10, radialVelocity: 5 } },
  ] : [];
  return {
    timestamp,
    source: 'live',
    cameraFrame: { sequence: step, timestamp: imageTime, width: 800, height: 448 },
    targets: [...radarTargets, ...tracks.map((trackId): Target => ({
      id: 'vision:' + trackId, observationTimestamp: imageTime,
      camera: { trackId, class: 'car', confidence: 0.9, bbox: [0.4, 0.3, 0.1, visualHeight] },
    }))],
  };
}

function follow(tracker: RadarCandidateTracker, tracks: string[]) {
  let frame = capturedFrame(0, tracks);
  for (let i = 0; i <= 16; i++) {
    frame = capturedFrame(i, tracks);
    tracker.update(frame);
  }
  return frame;
}

describe('雷达候选对照', () => {
  it('用摄像头采集时刻附近的雷达历史，区分轨迹候选和时间候选', () => {
    const tracker = new RadarCandidateTracker();
    const frame = follow(tracker, ['V001']);
    const visual = frame.targets.find((target) => target.camera)!;
    expect(visual.radarCandidates?.map((candidate) => [candidate.radarId, !!candidate.motion, candidate.timeDeltaMs]))
      .toEqual([['radar:41', true, 0], ['radar:42', false, 0]]);
    expect(visual.radar).toBeUndefined();
    expect(visual.fusion).toBeUndefined();
    const expired = capturedFrame(17, ['V001'], false);
    tracker.update(expired);
    expect(expired.targets[0].radarCandidates).toEqual([]);
  });

  it('两个方向都要领先才自动确认，时间和运动相似分数不足以确认身份', () => {
    const best = { visualId: 'A', radarId: 'R1', confidence: 96 };
    const competitor = { visualId: 'B', radarId: 'R1', confidence: 87 };
    const alternate = { visualId: 'A', radarId: 'R2', confidence: 82 };
    const independent = { visualId: 'C', radarId: 'R3', confidence: 85 };
    expect(confidentRadarPairs([best, alternate, independent])).toEqual([best, independent]);
    expect(confidentRadarPairs([best, competitor, alternate, independent])).toEqual([independent]);
    expect(confidentRadarPairs([best, { ...alternate, confidence: 90 }])).toEqual([]);

    const frame = capturedFrame(0, ['V001']);
    const radar = { ...frame.targets[0], observationTimestamp: frame.cameraFrame!.timestamp };
    const candidate = { radarId: radar.id, timeDeltaMs: 0, motion: { samples: 12, correlation: 1 } };
    expect(radarCandidateConfidence(frame, radar, candidate)).toBe(79);
    expect(radarCandidateConfidence(frame, radar, { ...candidate, reviewedTrackGapMs: 0 })).toBe(100);
  });
});
