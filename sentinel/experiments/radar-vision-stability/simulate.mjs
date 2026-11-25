
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

const { RiskFieldEngine } = await import(new URL('../../sentinel-backend/dist/src/engines/risk-field.engine.js', import.meta.url));
const output = fileURLToPath(new URL('../../../.cache/radar-vision-stability/', import.meta.url));
const stepMs = 100;
const runMs = 12000;
const seeds = 32;
const visualMaxAge = 320;
const stableField = process.argv.includes('--stable-field');
const stableFieldStep = .035;
const stableFieldCap = .105;
const steadyHint = stableField || process.argv.includes('--steady-hint');
const smoothed = steadyHint || process.argv.includes('--smoothed');
const responsive = smoothed || process.argv.includes('--responsive');
const windowed = responsive || process.argv.includes('--windowed');
const freeze = { start: 6200, end: 8900 };
const grid = { width: 101, height: 75, resolution: 3, xMin: -151.5, yMin: -21.5 };
const scenes = [
  { name: 'normal', label: '正常', missing: .07, delay: 40, variation: 75, slowChance: 0, noise: 1 },
  { name: 'delay', label: '抖动、丢帧与持续误检', missing: .19, delay: 65, variation: 120, slowChance: .26, noise: 1.5 },
  { name: 'freeze', label: '摄像头断流', missing: .07, delay: 40, variation: 75, slowChance: 0, noise: 1 },
];

const objects = [
  { id: 'car-a', category: 'car', start: 0, end: runMs, x: t => -1.65 + .45 * Math.sin(t), y: t => 64 - 3.5 * t, vx: t => .45 * Math.cos(t), vy: -3.5 },
  { id: 'car-b', category: 'car', start: 0, end: runMs, x: t => 2.0 + .38 * Math.sin(.7 * t), y: t => 28 + 2.6 * t, vx: t => .266 * Math.cos(.7 * t), vy: 2.6 },
  { id: 'walker', category: 'person', start: 2000, end: 10600, x: t => -8.2 + .30 * (t - 2), y: t => 22 + .12 * (t - 2), vx: () => .30, vy: .12 },
  { id: 'bike', category: 'bicycle', start: 1600, end: 10800, x: t => 7.7 + .26 * Math.sin(t / 2), y: t => 44 - 2 * (t - 1.6), vx: t => .13 * Math.cos(t / 2), vy: -2 },
];
const active = (object, time) => time >= object.start && time < object.end;
const position = (object, time) => ({ x: object.x(time / 1000), y: object.y(time / 1000) });
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const visionOnly = object => object.category !== 'car';
const objectIndex = new Map(objects.map(object => [object.id, object]));

function rng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return (state + .5) / 0x100000000;
  };
}
function normal(random) {
  return Math.sqrt(-2 * Math.log(random())) * Math.cos(2 * Math.PI * random());
}

function inputs(scene, seed) {
  const random = rng(seed * 32911 + 1337);
  const radar = [];
  const camera = [];
  for (let t = 0; t < runMs; t += stepMs) {
    const radarTracks = objects.filter(object => object.category === 'car').flatMap(object => {
      if (random() < .025) return [];
      const p = position(object, t);
      return [{
        id: object.id, category: 'car',
        x: p.x + .18 * normal(random), y: p.y + .31 * normal(random),
        vx: object.vx(t / 1000) + .10 * normal(random), vy: object.vy + .26 * normal(random),
      }];
    });
    radar.push({ time: t, arrival: t + 22 + 13 * random(), tracks: radarTracks });

    if (scene.name === 'freeze' && t >= freeze.start && t < freeze.end) continue;
    if (random() < scene.missing) continue;
    const tracks = objects.filter(object => active(object, t)).flatMap(object => {
      if (random() < (scene.name === 'delay' ? .085 : .035)) return [];
      const p = position(object, t);
      const cat = object.category === 'car' && random() < .03 ? 'bicycle' : object.category;
      const blur = scene.name === 'delay' && random() < .07 ? 3.2 : 1;
      return [{
        id: object.id, category: cat,
        x: p.x + scene.noise * blur * .36 * normal(random),
        y: p.y + scene.noise * blur * .58 * normal(random),
        confidence: .68 + .30 * random(),
      }];
    });
    if (random() < .09) tracks.push({
      id: 'fleeting-' + t, category: 'person',
      x: -11 + 21 * random(), y: 13 + 44 * random(), confidence: .73 + .25 * random(),
    });
    if (scene.name === 'delay' && t >= 1050 && t <= 1750) tracks.push({
      id: 'persistent-false', category: 'bicycle',
      x: -5.8 + .13 * normal(random), y: 16.3 + .24 * normal(random), confidence: .96,
    });
    const spike = random() < scene.slowChance ? 180 + 250 * random() : 0;
    camera.push({ time: t, arrival: t + scene.delay + scene.variation * random() + spike, tracks });
  }
  camera.sort((a, b) => a.arrival - b.arrival);
  return { radar, camera };
}

function updateVision(tracks, event) {
  for (const observed of event.tracks) {
    if (!['person', 'bicycle'].includes(observed.category) ||
        observed.confidence < .72 || Math.abs(observed.x) > 11 ||
        observed.y < 8 || observed.y > 62) {
      continue;
    }
    const prior = tracks.get(observed.id);
    const elapsed = prior ? event.time - prior.time : Infinity;
    if (prior && elapsed <= 0) continue;
    if (prior && elapsed <= 240 && distance(prior, observed) > 3) continue;
    const adjacent = elapsed === stepMs && prior?.category === observed.category;
    const stillConfirmed = prior?.confirmed && elapsed <= 220 && prior?.category === observed.category;
    const sameCategory = prior?.category === observed.category;
    const recent = (windowed && sameCategory ? prior.recent : [])
      .filter(item => event.time - item.time <= (responsive ? 500 : 400));
    recent.push({ time: event.time, x: observed.x, y: observed.y, confidence: observed.confidence });
    const usePrior = adjacent || stillConfirmed || (windowed && sameCategory && elapsed <= 240);
    const hits = windowed ? recent.length : usePrior ? prior.hits + 1 : 1;
    const strong = hits >= 3 || (windowed && stillConfirmed && prior.strong);
    const corroborated = responsive && observed.confidence >= .78 && recent.slice(0, -1).some(
      item => item.confidence >= .78 && distance(item, observed) <= 2.2,
    );
    tracks.set(observed.id, {
      ...observed, time: event.time, hits, recent, strong, confirmed: strong || corroborated,
      x: usePrior ? .5 * prior.x + .5 * observed.x : observed.x,
      y: usePrior ? .5 * prior.y + .5 * observed.y : observed.y,
    });
  }
}

function acceptedVision(tracks, radarHistory, now) {
  const selected = [];
  for (const [id, track] of tracks) {
    const age = now - track.time;
    if (age >= visualMaxAge) {
      if (!responsive || age > 550) tracks.delete(id);
      continue;
    }
    if (!track.confirmed) continue;
    const paired = radarHistory.filter(packet => Math.abs(packet.time - track.time) <= 120).flatMap(packet => packet.tracks);
    if (paired.some(radar => distance(radar, track) <= 3)) continue;
    const fade = Math.min(1, (visualMaxAge - age) / 170);
    const fullWeight = (track.strong ? .70 : .35) * track.confidence;
    selected.push({ ...track, fullWeight, fade, weight: fullWeight * fade });
  }
  return selected;
}

function riskObj(target, measuredSpeed) {
  const { x, y } = target;
  const vx = measuredSpeed ? target.vx : 0;
  const vy = measuredSpeed ? target.vy : 0;
  const range = Math.hypot(x, y);
  return {
    id: target.id,
    fusion: {
      x, y, speed: Math.hypot(vx, vy), heading: Math.atan2(vx, vy) * 180 / Math.PI,
      radialVelocity: range ? (x * vx + y * vy) / range : 0,
    },
    risk: { value: 0, level: 'low' },
  };
}

function combineField(baseline, vision, engine) {
  if (!vision.length) return baseline;
  const values = new Float32Array(baseline);
  for (const track of vision) {
    const contribution = engine.compute([riskObj(track, false)]).values;
    for (let i = 0; i < values.length; i++) {
      values[i] += (1 - values[i]) * track.weight * contribution[i];
    }
  }
  return values;
}

function limitVisualChange(baseline, candidate, previous) {
  let changed = false;
  const output = Float32Array.from(baseline, (base, index) => {
    const desired = Math.min(stableFieldCap, candidate[index] - base);
    const last = previous?.[index] ?? 0;
    const addition = Math.max(last - stableFieldStep, Math.min(last + stableFieldStep, desired), 0);
    changed ||= addition > 1e-7;
    return Math.min(1, base + addition);
  });
  return changed ? output : baseline;
}

const quantile = (items, p) => {
  const sorted = [...items].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)] : null;
};
const rate = (n, total) => Math.round(n * 1000 / total) / 10;
const makeTotals = () => ({
  frames: 0, slots: 0, radarAge: [], radarIntervals: [], radarCpu: [], extraCpu: [], naive: { covered: 0, duplicate: 0, falseFrames: 0, onset: [], jitter: [] },
  fused: { covered: 0, duplicate: 0, falseFrames: 0, onset: [], jitter: [] }, ageAfterFreeze: [], allFrozenGridsEqual: true,
  persistentFalseFrames: 0,
  heatJumps: [], noticeableOnset: [],
});

function evaluate(tracks, radar, time, totals, firstSeen) {
  let falseHeat = false;
  let duplicate = false;
  const matched = new Map();
  for (const track of tracks) {
    const object = objectIndex.get(track.id);
    if (!object || !active(object, time) || distance(track, position(object, time)) > 2.5) {
      falseHeat = true;
      continue;
    }
    if (!visionOnly(object)) {
      if (radar.some(r => r.id === object.id)) duplicate = true;
      continue;
    }
    matched.set(object.id, {
      x: track.x - object.x(time / 1000), y: track.y - object.y(time / 1000),
    });
    if (!firstSeen.has(object.id)) firstSeen.set(object.id, time - object.start);
  }
  totals.covered += matched.size;
  totals.duplicate += Number(duplicate);
  totals.falseFrames += Number(falseHeat);
  return matched;
}

let comparison = null;
const browserFrames = [];
function run(scene, seed, totals, savePlot = false) {
  const sensor = inputs(scene, seed);
  const tracked = new Map();
  const radarHistory = [];
  const radarEngine = new RiskFieldEngine(grid, 'circular');
  const visionEngine = new RiskFieldEngine(grid, 'circular');
  const firstSeen = { naive: new Map(), fused: new Map() };
  let previous = { naive: new Map(), fused: new Map() };
  let nextVision = 0;
  let latestCamera = null;
  let priorArrival;
  let clearAfterFreeze = null;
  let cutoffChecked = false;
  const visualGain = new Map();
  let previousContribution = null;
  const noticeable = new Map();

  for (const packet of sensor.radar) {
    const now = packet.arrival;
    radarHistory.push(packet);
    totals.frames++;
    totals.slots += objects.filter(obj => visionOnly(obj) && active(obj, now)).length;
    totals.radarAge.push(now - packet.time);
    if (priorArrival !== undefined) totals.radarIntervals.push(now - priorArrival);
    priorArrival = now;

    const beforeRadar = performance.now();
    const baseline = radarEngine.compute(packet.tracks.map(track => riskObj(track, true))).values;
    totals.radarCpu.push(performance.now() - beforeRadar);
    const beforeFusion = performance.now();
    while (radarHistory[0] && now - radarHistory[0].time > visualMaxAge + 180) radarHistory.shift();
    while (nextVision < sensor.camera.length && sensor.camera[nextVision].arrival <= now) {
      const event = sensor.camera[nextVision++];
      if (now - event.time < visualMaxAge && (!latestCamera || event.time > latestCamera.time)) {
        latestCamera = event;
        updateVision(tracked, event);
      }
    }
    const fusedTracks = acceptedVision(tracked, radarHistory, now);
    if (smoothed) {
      const selected = new Set(fusedTracks.map(target => target.id));
      for (const id of visualGain.keys()) if (!selected.has(id)) visualGain.delete(id);
      for (const target of fusedTracks) {
        const previous = visualGain.get(target.id);
        const elapsed = previous ? now - previous.time : stepMs;
        const amount = previous?.amount ?? (steadyHint ? .35 * target.confidence : 0);
        const next = amount + (target.fullWeight - amount) * (1 - Math.exp(-elapsed / 220));
        visualGain.set(target.id, { amount: next, time: now });
        target.weight = next * target.fade;
      }
    }
    totals.persistentFalseFrames += Number(fusedTracks.some(track => track.id === 'persistent-false'));
    const candidate = combineField(baseline, fusedTracks, visionEngine);
    const field = stableField ? limitVisualChange(baseline, candidate, previousContribution) : candidate;
    totals.extraCpu.push(performance.now() - beforeFusion);
    const contribution = Float32Array.from(field, (value, index) => value - baseline[index]);
    if (previousContribution) {
      let jump = 0;
      for (let i = 0; i < contribution.length; i++) jump = Math.max(jump, Math.abs(contribution[i] - previousContribution[i]));
      if (stableField) assert.ok(jump <= stableFieldStep + 1e-6, 'Visual contribution exceeded the frame step limit');
      totals.heatJumps.push(jump);
    }
    previousContribution = contribution;
    if (stableField && scene.name === 'freeze' && seed === 1 && packet.time >= 5500 && packet.time <= 9700) {
      browserFrames.push({
        field: Array.from(field, value => Math.round(value * 10000) / 10000),
        visual: field !== baseline,
        radar: packet.tracks,
      });
    }
    for (const target of fusedTracks) {
      const object = objectIndex.get(target.id);
      if (!object || !visionOnly(object) || !active(object, now) || noticeable.has(target.id)) continue;
      const col = Math.floor((target.x - grid.xMin) / grid.resolution);
      const row = Math.floor((target.y - grid.yMin) / grid.resolution);
      if (contribution[row * grid.width + col] >= .03 && distance(target, position(object, now)) <= 2.5) {
        noticeable.set(target.id, now - object.start);
      }
    }
    const naiveTracks = latestCamera && now - latestCamera.time < visualMaxAge ? latestCamera.tracks : [];

    if (!stableField && !fusedTracks.length) assert.equal(field, baseline);
    if (field !== baseline) {
      assert.ok(field.every((cell, i) => Number.isFinite(cell) && cell >= baseline[i] && cell <= 1));
    }

    const current = {
      naive: evaluate(naiveTracks, packet.tracks, now, totals.naive, firstSeen.naive),
      fused: evaluate(fusedTracks, packet.tracks, now, totals.fused, firstSeen.fused),
    };
    for (const id of current.fused.keys()) {
      if (current.naive.has(id) && previous.naive.has(id) && previous.fused.has(id)) {
        totals.naive.jitter.push(distance(current.naive.get(id), previous.naive.get(id)));
        totals.fused.jitter.push(distance(current.fused.get(id), previous.fused.get(id)));
      }
    }
    previous = current;

    if (scene.name === 'freeze' && now >= freeze.start && now < freeze.end) {
      if (field === baseline && clearAfterFreeze === null) clearAfterFreeze = now - freeze.start;
      if (now >= freeze.start + visualMaxAge + (stableField ? 3 * stepMs : 0)) {
        cutoffChecked = true;
        totals.allFrozenGridsEqual &&= field === baseline;
      }
    }
    if (savePlot && now >= 4450 && now <= 5200 && !comparison &&
        fusedTracks.some(track => track.id === 'walker') && fusedTracks.some(track => track.id === 'bike')) {
      comparison = {
        seconds: now / 1000, grid, baseline: [...baseline], fusion: [...field],
        radar: packet.tracks, vision: fusedTracks,
      };
    }
  }
  for (const label of ['naive', 'fused']) totals[label].onset.push(...firstSeen[label].values());
  totals.noticeableOnset.push(...noticeable.values());
  if (cutoffChecked) {
    assert.ok(clearAfterFreeze !== null);
    totals.ageAfterFreeze.push(clearAfterFreeze);
  }
}

run(scenes[0], 418, makeTotals());
run(scenes[1], 419, makeTotals());
const rows = [];
for (const scene of scenes) {
  const sums = makeTotals();
  for (let seed = 1; seed <= seeds; seed++) run(scene, seed, sums, scene.name === 'normal');
  assert.ok(sums.allFrozenGridsEqual);
  const metrics = method => ({
    coveragePct: rate(method.covered, sums.slots),
    duplicateFramesPct: rate(method.duplicate, sums.frames),
    falseHeatFramesPct: rate(method.falseFrames, sums.frames),
    onsetP50Ms: quantile(method.onset, .5), onsetP95Ms: quantile(method.onset, .95),
    onsetSuccesses: method.onset.length, onsetTotal: seeds * 2,
    positionJitterP95M: quantile(method.jitter, .95), pairedJitterSamples: method.jitter.length,
  });
  rows.push({
    scene: scene.label, name: scene.name, frames: sums.frames, truthSlots: sums.slots,
    radarDeliveryP95MsBaseline: quantile(sums.radarAge, .95), radarDeliveryP95MsFused: quantile(sums.radarAge, .95),
    radarIntervalP95Ms: quantile(sums.radarIntervals, .95),
    radarComputeP95Ms: quantile(sums.radarCpu, .95), extraFusionComputeP95Ms: quantile(sums.extraCpu, .95),
    radarOnlyCoveragePct: 0, naive: metrics(sums.naive), fused: metrics(sums.fused),
    freezeClearP50Ms: quantile(sums.ageAfterFreeze, .5), freezeClearMaxMs: quantile(sums.ageAfterFreeze, 1),
    matchedOldFieldWhenCameraStale: scene.name === 'freeze' ? sums.allFrozenGridsEqual : null,
    persistentFalseFrames: sums.persistentFalseFrames,
    visualCellJumpP95: quantile(sums.heatJumps, .95),
    visualCellJumpP99: quantile(sums.heatJumps, .99),
    visualCellJumpMax: quantile(sums.heatJumps, 1),
    jumpsAbove008: sums.heatJumps.filter(jump => jump > .08).length,
    noticeableOnsetP95Ms: quantile(sums.noticeableOnset, .95),
    noticeableTargets: sums.noticeableOnset.length,
  });
}
assert.ok(comparison);
const file = stableField ? 'stable-field' : steadyHint ? 'steady-hint' : smoothed ? 'smoothed' : responsive ? 'responsive' : windowed ? 'windowed' : 'strict';
fs.mkdirSync(output, { recursive: true });
fs.writeFileSync(join(output, file + '-results.json'), JSON.stringify({ stepMs, seeds, runMs, visualMaxAge, freeze, scenes: rows }, null, 2));
fs.writeFileSync(join(output, file + '-heatmaps.json'), JSON.stringify(comparison));
if (stableField) fs.writeFileSync(join(output, 'stable-browser-frames.json'), JSON.stringify({ grid, browserFrames }));
console.log(JSON.stringify({ output, scenes: rows }, null, 2));
