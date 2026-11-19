import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LiveRiskField } from '../src/live/risk.js';
import type { RadarObservation } from '../src/live/tcr300.js';

const now = Date.now();
function observation(overrides: Partial<RadarObservation> = {}): RadarObservation {
  return { target_seq: 1, track_id: 7, host_received_utc: new Date(now).toISOString(),
    range: 20, angle: 0, x_lateral: 0, y_longitudinal: 20,
    vx_lateral: 0, vy_longitudinal: -8, rcs: 1, ...overrides };
}
test('live radar field uses measured motion, includes low values and peaks near the target', () => {
  const approaching = new LiveRiskField().snapshot([observation()], now, now)!;
  const receding = new LiveRiskField().snapshot([observation({ vy_longitudinal: 8 })], now, now)!;
  const peak = Math.max(...approaching.display_field);
  assert.ok(peak > Math.max(...receding.display_field));
  assert.ok(approaching.display_field.some(v => v > 0 && v < .25));
  assert.ok(approaching.display_field.every(v => Number.isFinite(v) && v >= 0 && v <= 1));
  const index = approaching.display_field.indexOf(peak);
  assert.ok(Math.abs(approaching.x_axis[index % approaching.grid_width]!) <= 1);
  assert.ok(Math.abs(approaching.y_axis[Math.floor(index / approaching.grid_width)]! - 20) <= 1);
  assert.equal(approaching.field_scope, 'radar_only');
  assert.equal(approaching.calibration_valid, false);
  assert.equal(approaching.vision_sequence, null);
});
test('empty live cycles clear contributions; stale, future and invalid observations do not become zero-risk fields', () => {
  const engine = new LiveRiskField();
  const populated = engine.snapshot([observation()], now, now)!;
  const empty = engine.snapshot([], now + 1, now + 1)!;
  assert.ok(empty.display_field.every(v => v === 0));
  assert.ok(populated.display_field.some(v => v > 0), 'previous snapshot is immutable');
  assert.equal(engine.snapshot([], null, now), null);
  assert.equal(engine.snapshot([], now, now + 1501), null);
  assert.equal(engine.snapshot([observation()], now + 1600, now + 1600), null);
  assert.equal(engine.snapshot([observation({ vx_lateral: NaN })], now, now), null);
  assert.equal(engine.snapshot([observation()], now, now - 1), null);
});
test('live influence is circular across headings and the horizontal axis spans at least 300 metres', () => {
  const field = new LiveRiskField().snapshot([observation({ range: 40, vy_longitudinal: -8 })], now, now)!;
  const diagonal = new LiveRiskField().snapshot([observation({ range: 40, vx_lateral: 8 / Math.sqrt(2), vy_longitudinal: -8 / Math.sqrt(2) })], now, now)!;
  assert.ok(field.x_axis[0]! <= -150 && field.x_axis.at(-1)! >= 150);
  assert.equal(field.model_version, 'live-radar-circular-distance-ttc-v2');
  for (const f of [field, diagonal]) {
    const at = (x: number, y: number) => f.display_field[f.y_axis.indexOf(y) * f.grid_width + f.x_axis.indexOf(x)]!;
    assert.ok(at(0, 40) > at(6, 40) && at(6, 40) > 0);
    for (const offset of [3, 6, 9, 12]) {
      assert.equal(at(offset, 40), at(-offset, 40));
      assert.equal(at(offset, 40), at(0, 40 + offset));
      assert.equal(at(offset, 40), at(0, 40 - offset));
    }
  }
});
test('live field expands to actual targets without unbounded payloads or shrinking on empty cycles', () => {
  const engine = new LiveRiskField();
  const field = engine.snapshot([observation({ range: 350, angle: 70 })], now, now)!;
  const x = 350 * Math.sin(70 * Math.PI / 180), y = 350 * Math.cos(70 * Math.PI / 180);
  assert.ok(field.x_axis[0]! < x && field.x_axis.at(-1)! > x);
  assert.ok(field.y_axis[0]! < y && field.y_axis.at(-1)! > y);
  assert.ok(field.grid_width <= 121 && field.grid_height <= 121);
  assert.ok(Buffer.byteLength(JSON.stringify(field)) < 200 * 1024);
  const empty = engine.snapshot([], now + 1, now + 1)!;
  assert.deepEqual(empty.x_axis, field.x_axis);
  assert.deepEqual(empty.y_axis, field.y_axis);
});
