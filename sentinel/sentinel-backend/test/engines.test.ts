import test from 'node:test';
import assert from 'node:assert/strict';
import { FusionEngine, mahalanobis } from '../src/engines/fusion.engine.js';
import { RiskFieldEngine } from '../src/engines/risk-field.engine.js';
import { SensorSimulator } from '../src/simulator/sensor.simulator.js';
import type { SensorBatch, Target } from '../src/contracts.js';
import { config } from '../src/config.js';

function batch(timestamp: number, y = 20): SensorBatch {
  const k = config.camera, height = k.focal * 1.5 / y;
  return { timestamp, radar: [{ timestamp, range: y, azimuth: 0, radialVelocity: -2, covariance: { xx: 1, xy: 0.2, yy: 1 } }], camera: [{ timestamp, bbox: [k.cx - 20, k.cy + k.focal * k.heightMeters / y - height, 40, height], class: 'Car', confidence: 0.95, covariance: { xx: 1, xy: 0.2, yy: 1 } }] };
}
test('Mahalanobis uses the full correlated covariance', () => {
  const a = { x: 0, y: 0, covariance: { xx: 1, xy: 0.5, yy: 1 } };
  const b = { ...a, x: 1, y: 1 };
  assert.ok(Math.abs(mahalanobis(a, b) - 2 / 3) < 1e-10);
});
test('fuses calibrated observations and preserves identity through modality loss', () => {
  const engine = new FusionEngine();
  const first = engine.update(batch(100));
  assert.equal(first.targets.length, 1); assert.equal(first.statuses[0]?.tag, 'fused');
  assert.ok(Math.abs(first.targets[0]!.fusion.y - 20) < 1e-8);
  const onlyRadar = batch(200, 19.8); onlyRadar.camera = [];
  const second = engine.update(onlyRadar);
  assert.equal(second.targets[0]?.id, first.targets[0]?.id); assert.equal(second.statuses[0]?.tag, 'radar_only');
  const onlyCamera = batch(300, 19.6); onlyCamera.radar = [];
  const third = engine.update(onlyCamera);
  assert.equal(third.targets[0]?.id, first.targets[0]?.id); assert.equal(third.statuses[0]?.tag, 'vision_only');
  assert.equal(third.statuses[0]?.velocityValid, true);
});
test('time gating, one-to-one assignment and invalid measurements', () => {
  const engine = new FusionEngine(), input = batch(200);
  input.camera[0]!.timestamp = 100;
  assert.equal(engine.update(input).targets.length, 2);
  const duplicate = batch(400); duplicate.camera.push({ ...duplicate.camera[0]! });
  assert.equal(new FusionEngine().update(duplicate).targets.length, 2);
  const invalid = batch(600); invalid.radar[0]!.range = NaN; invalid.camera[0]!.timestamp = 0;
  assert.equal(engine.update(invalid).targets.length, 0);
});
test('risk is bounded, sparse, stronger on approach; empty scene clears field', () => {
  const target = (velocity: number): Target => ({ id: 'T1', fusion: { x: 0, y: 5, speed: Math.abs(velocity), heading: 180, azimuth: 0, radialVelocity: velocity, tangentialVelocity: 0 }, risk: { value: 0, level: 'low' } });
  const engine = new RiskFieldEngine(), approaching = target(-10), receding = target(10);
  const result = engine.compute([approaching]); engine.compute([receding]);
  assert.ok(approaching.risk.value > receding.risk.value);
  assert.ok(result.field.highRiskZones.length > 0); assert.ok(result.contours.length > 0);
  for (const zone of result.field.highRiskZones) {
    assert.ok(zone.startColumn + zone.values.length <= config.grid.width);
    assert.ok(zone.values.every(v => v >= 0.5 && v <= 1));
  }
  assert.deepEqual(engine.compute([]).field.highRiskZones, []);
});
test('deterministic physical simulator and end-to-end finite output', () => {
  const a = new SensorSimulator(), b = new SensorSimulator(), fusion = new FusionEngine(), risk = new RiskFieldEngine();
  for (let i = 1; i <= 100; i++) {
    const sample = a.sample(0.1, i * 100);
    assert.deepEqual(sample, b.sample(0.1, i * 100));
    const fused = fusion.update(sample), computed = risk.compute(fused.targets);
    assert.ok(fused.targets.every(t => Object.values(t.fusion).every(Number.isFinite)));
    assert.ok(Buffer.byteLength(JSON.stringify({ targets: fused.targets, riskField: computed.field })) < config.maxFrameBytes);
  }
  a.reset(); b.reset(); assert.deepEqual(a.sample(0.1, 100), b.sample(0.1, 100));
});
