import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { sampleField } from '../../core/RealDataAdapter';
import candidates from './bundledReplayCandidates.json';
import { indexReplayRiskHistory, parseReplayPackets, replayDataFiles } from './bundledReplay';
import { targetDisplayName } from '../core/targetLabels';
import { useSceneStore } from '../stores/scene';

const folder = new URL('../../../public/history/2026-11-22-164403/', import.meta.url);
const contents = replayDataFiles.map(name => readFileSync(new URL(name, folder), 'utf8'));
const packetIndices = new Map(contents[0].trim().split(/\r?\n/).slice(1).flatMap(line => {
  const [, , index, , , pts] = line.split(',');
  return pts ? [[Number(pts), Number(index)] as const] : [];
}));

it('applies every reviewed link to its original frame while keeping independent observations', () => {
  const playback = parseReplayPackets(contents, true, candidates);
  const actual = new Set<string>();
  for (const packet of playback) {
    const index = packetIndices.get(packet.pts);
    expect(packet.frame.riskField?.scope).toBe('radar_only');
    const claimedRadar = new Set<string>();
    const claimedVision = new Set<string>();
    for (const target of packet.frame.targets) {
      const link = target.autoAssociation;
      if (!link) continue;
      expect(target.id).toBe(link.radarId);
      expect(target.camera?.trackId).toBe(link.visualTrackId);
      expect(target.radar).toBeDefined();
      expect(claimedRadar.has(link.radarId) || claimedVision.has(link.visualTrackId)).toBe(false);
      claimedRadar.add(link.radarId);
      claimedVision.add(link.visualTrackId);
      if (link.method === 'offline-trajectory-fit') actual.add(`${index} ${link.visualTrackId} ${link.radarId}`);
    }
  }
  const expected = candidates.flatMap(link => link.packetIndices.map(index => `${index} ${link.visualTrackId} ${link.radarId}`));
  expect(actual).toEqual(new Set(expected));
  expect(actual.has('12 V00234 radar:62')).toBe(true);
  expect(actual.has('104 V00256 radar:100')).toBe(true);
  expect(actual.has('105 V00256 radar:100')).toBe(false);
  expect(actual.has('105 V00259 radar:100')).toBe(false);
  expect(playback.some(({ frame }) => frame.targets.some(target => target.camera && !target.radar))).toBe(true);
});

it('keeps a vehicle name through the visual tail without carrying its radar measurements', () => {
  const playback = parseReplayPackets(contents, true, candidates);
  const at = (index: number) => playback.find(packet => packetIndices.get(packet.pts) === index)!.frame;
  const observed = at(95).targets.find(target => target.id === 'radar:102')!;
  const visual = at(104).targets.find(target => target.camera?.trackId === 'V00247')!;
  expect(visual.lastLinkedRadarId).toBe(observed.id);
  expect(visual.radar).toBeUndefined();
  expect(visual.autoAssociation).toBeUndefined();
  expect(visual.fusion).toBeUndefined();
  expect(visual.risk).toBeUndefined();
  expect(targetDisplayName(observed)).toBe('车辆 102');
  expect(targetDisplayName(visual)).toBe(targetDisplayName(observed));
  const unpaired = at(0).targets.find(target => target.camera?.trackId === 'V00234');
  expect(unpaired?.lastLinkedRadarId).toBeUndefined();
  expect(unpaired?.visualNumber).toBeGreaterThanOrEqual(1);
  expect(targetDisplayName(unpaired)).toBe(`车辆 W${unpaired?.visualNumber}`);
  expect(targetDisplayName(unpaired, { showVisualNumber: false })).toBe('未关联车辆');
  expect(targetDisplayName({ id: 'radar:69', radar: { range: 20, azimuth: 0, radialVelocity: 0 } })).toBe('车辆 69');
  const expired = at(149).targets.find(target => target.camera?.trackId === 'V00257');
  expect(expired?.risk).toBeUndefined();
  expect(targetDisplayName(expired)).toBe('车辆 87');
});

it('retires an old display name when a radar track is paired to another visible track', () => {
  const playback = parseReplayPackets(contents, true, candidates);
  const frame = playback.find(packet => packetIndices.get(packet.pts) === 106)!.frame;
  const current = frame.targets.find(target => target.camera?.trackId === 'V00259');
  const former = frame.targets.find(target => target.camera?.trackId === 'V00256');
  expect(targetDisplayName(current)).toBe('车辆 100');
  expect(targetDisplayName(former)).toBe(`车辆 W${former?.visualNumber}`);
  expect(former?.lastLinkedRadarId).toBeUndefined();
});

it('continues reviewed tracks using current measurements and skips contested identities', () => {
  const playback = parseReplayPackets(contents, true, candidates);
  const at = (index: number) => playback.find(packet => packetIndices.get(packet.pts) === index)!.frame;
  const linked = at(105).targets.find(target => target.id === 'radar:101')!;
  expect(linked.autoAssociation).toMatchObject({
    method: 'replay-candidate', basis: 'track-continuation', visualTrackId: 'V00252',
  });
  expect(linked.camera?.trackId).toBe('V00252');
  expect(Math.abs(at(105).cameraFrame!.timestamp - linked.observationTimestamp!)).toBeLessThanOrEqual(160);
  expect(at(105).targets.find(target => target.id === 'radar:100')?.camera).toBeUndefined();
});

it('uses a time-aligned radar sample from an adjacent packet and samples the current field', () => {
  const playback = parseReplayPackets(contents, true, candidates);
  const at = (index: number) => playback.find(packet => packetIndices.get(packet.pts) === index)!.frame;
  const measured = at(94).targets.find(target => target.id === 'radar:102')!;
  const frame = at(95);
  const linked = frame.targets.find(target => target.id === measured.id)!;
  expect(linked.autoAssociation).toMatchObject({
    method: 'replay-candidate', basis: 'adjacent-observation', visualTrackId: 'V00247', timeDeltaMs: 85,
  });
  expect(linked.observationTimestamp).toBe(measured.observationTimestamp);
  expect(linked.fusion).toBe(measured.fusion);
  const { x, y } = measured.fusion!;
  expect(linked.risk?.value).toBe(sampleField(frame.riskField, x, y));
  expect(linked.risk?.value).not.toBe(measured.risk?.value);
  expect(frame.targets.filter(target => target.camera?.trackId === 'V00247')).toEqual([linked]);

  const gap = at(92).targets.filter(target => target.id === 'radar:101');
  expect(gap).toHaveLength(1);
  expect(gap[0].autoAssociation).toMatchObject({ basis: 'track-continuation', visualTrackId: 'V00252' });
  expect(gap[0].risk).toBeDefined();
});

it('shows current radar measurements only, even for a previously named visual track', () => {
  setActivePinia(createPinia());
  const store = useSceneStore();
  const playback = parseReplayPackets(contents, true, candidates);
  const seek = (pts: number, id: string) => {
    store.frame = playback.find(packet => packet.pts === pts)!.frame;
    store.select(id);
  };
  seek(7400, 'radar:102');
  expect(store.selectedMeasurement?.risk?.value).toBeCloseTo(0.043, 3);

  seek(15900, 'vision:V00281');
  expect(store.selected?.lastLinkedRadarId).toBe('radar:124');
  expect(store.selectedMeasurement).toBeUndefined();

  seek(6933.333, 'vision:V00245');
  const riskCount = store.knownRiskTargets.length;
  expect(riskCount).toBeGreaterThan(0);
  expect(store.selected?.camera).toBeDefined();
  expect(store.selectedMeasurement).toBeUndefined();
  expect(store.knownRiskTargets).toHaveLength(riskCount);
});

it('automatically confirms the strongest reviewed candidates and retains competing pairs', () => {
  const playback = parseReplayPackets(contents, true, candidates);
  const at = (index: number) => playback.find(packet => packetIndices.get(packet.pts) === index)!.frame;
  expect(at(43).targets.find(target => target.id === 'radar:96')?.autoAssociation).toMatchObject({
    method: 'replay-candidate', basis: 'confidence', confidence: 96, visualTrackId: 'V00241',
  });
  expect(at(43).targets.find(target => target.id === 'radar:96')?.risk).toBeDefined();
  expect(at(105).targets.find(target => target.id === 'radar:100')?.autoAssociation).toBeUndefined();

  setActivePinia(createPinia());
  const store = useSceneStore();
  store.frame = playback.find(packet => packet.pts === 14200)!.frame;
  store.select('vision:V00267');
  expect(targetDisplayName(store.selected)).toBe(`车辆 W${store.selected?.visualNumber}`);
  expect(store.selectedMeasurement).toBeUndefined();

  store.frame = playback.find(packet => packet.pts === 8700)!.frame;
  store.select('vision:V00258');
  expect(store.selected?.camera).toBeDefined();
  expect(playback.every(({ frame }) => frame.targets.every(target => target.radarCandidates === undefined))).toBe(true);
  expect(store.selectedMeasurement).toBeUndefined();
});

it('picks another measured vehicle during replay and preserves paused inspection', () => {
  setActivePinia(createPinia());
  const store = useSceneStore();
  const playback = parseReplayPackets(contents, true, candidates);
  store.frame = playback.find(packet => packet.pts === 8700)!.frame;
  store.select('vision:V00258');
  store.playing = false;
  store.keepReplayRiskSelection();
  expect(store.selectedId).toBe('vision:V00258');
  expect(store.selectedMeasurement).toBeUndefined();

  store.playing = true;
  store.keepReplayRiskSelection();
  expect(store.selectedId).toBe('radar:100');
  expect(store.selectedMeasurement?.risk?.value).toBeCloseTo(0.691, 3);

  store.select('radar:90');
  store.keepReplayRiskSelection();
  expect(store.selectedId).toBe('radar:90');

  const visual = store.frame.targets.find(target => target.id === 'vision:V00258')!;
  store.frame = { ...store.frame, targets: [visual] };
  store.select(visual.id);
  store.keepReplayRiskSelection();
  expect(store.selectedId).toBe(visual.id);
  expect(store.selectedMeasurement).toBeUndefined();
});

it('uses stable W-prefixed visual numbers distinct from radar IDs', () => {
  const playback = parseReplayPackets(contents, true, candidates);
  const visualNumbers = new Map<string, number>();
  const radarNumbers = new Set(playback.flatMap(({ frame }) => frame.targets.filter(target => target.radar).map(target => targetDisplayName(target))));
  for (const { frame } of playback) {
    for (const target of frame.targets) {
      if (target.visualNumber === undefined || target.lastLinkedRadarId) continue;
      const number = visualNumbers.get(target.id);
      if (number !== undefined) expect(target.visualNumber).toBe(number);
      visualNumbers.set(target.id, target.visualNumber);
      expect(targetDisplayName(target)).toMatch(/ W\d+$/);
      expect(radarNumbers.has(targetDisplayName(target))).toBe(false);
    }
  }
  expect(visualNumbers.size).toBeGreaterThan(1);
  expect(new Set(visualNumbers.values()).size).toBe(visualNumbers.size);
});

it('indexes risk history by each occurrence of a reused radar number', () => {
  const playback = parseReplayPackets(contents, true, candidates);
  const measured = playback.flatMap(({ frame }) => frame.targets).find(target => target.radar && target.risk)!;
  const frame = playback[0].frame;
  const first = { ...measured, trackInstanceId: 'radar:200@100', id: 'radar:200' };
  const second = { ...first, trackInstanceId: 'radar:200@2000' };
  const history = indexReplayRiskHistory([
    { pts: 2000, frame: { ...frame, targets: [second] } },
    { pts: 100, frame: { ...frame, targets: [first] } },
  ]);
  expect(targetDisplayName(first)).toBe(targetDisplayName(second));
  expect(history.get(first.trackInstanceId)).toEqual([[0.1, first.risk!.value], [2, null]]);
  expect(history.get(second.trackInstanceId)).toEqual([[2, second.risk!.value]]);
});
