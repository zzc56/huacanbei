import { describe, it, expect } from 'vitest';
import { RadarSimulator } from './radarSim';
import { FusionSimulator } from './fusionSim';
import { worldToScreen, screenToWorld, createDefaultTransform } from '@/utils/coords';

describe('RadarSimulator & Data Layer Acceptance (M2)', () => {
  it('produces >= 10 batches within 2s equivalent steps with complete fields and prunes expired targets', () => {
    const sim = new RadarSimulator('busy');
    const batches = [];
    let now = 1_000_000;
    for (let i = 0; i < 20; i++) {
      now += 100;
      const b = sim.stepBatch(now);
      if (b.length > 0) batches.push(b);
    }
    expect(batches.length).toBeGreaterThanOrEqual(10);
    const sample = batches[0][0];
    expect(typeof sample.id).toBe('number');
    expect(typeof sample.x).toBe('number');
    expect(typeof sample.y).toBe('number');
    expect(typeof sample.vx).toBe('number');
    expect(typeof sample.vy).toBe('number');
    expect(sample.vendorTime).toMatch(/^\d{2}:\d{2}:\d{2}\.\d{3}$/);

    // Verify 2-second expiration pruning
    const activeAt2s = sim.getActiveTargets(now, 2000);
    expect(activeAt2s.length).toBeGreaterThan(0);
    const activeAfter5s = sim.getActiveTargets(now + 5000, 2000);
    expect(activeAfter5s.length).toBe(0);
  });

  it('strictly sets displayField=null when expired or unavailable (never zero-filled)', () => {
    const fsim = new FusionSimulator();
    fsim.setDemoMode('expired');
    const expiredSnap = fsim.buildSnapshot([]);
    expect(expiredSnap.status).toBe('expired');
    expect(expiredSnap.displayField).toBeNull();
    expect(expiredSnap.radarObjects.length).toBe(0);
    expect(expiredSnap.pedestrians.length).toBe(0);

    fsim.setDemoMode('uncalibrated');
    fsim.setConfig({ extendRadarField: false });
    const uncalHidden = fsim.buildSnapshot([]);
    expect(uncalHidden.displayField).toBeNull();

    fsim.setConfig({ extendRadarField: true });
    const uncalExtended = fsim.buildSnapshot([]);
    expect(uncalExtended.config.fieldScope).toBe('radar_only');
    expect(uncalExtended.displayField).not.toBeNull();
    expect(uncalExtended.pedestrians.length).toBe(0);
  });

  it('transforms world <-> screen coordinates invertibly', () => {
    const range = { xMin: -20, xMax: 20, yMin: 0, yMax: 100 };
    const bounds = { left: 53, top: 24, right: 653, bottom: 524, width: 600, height: 500 };
    const tf = createDefaultTransform();
    const { sx, sy } = worldToScreen(5, 40, range, bounds, tf);
    const { wx, wy } = screenToWorld(sx, sy, range, bounds, tf);
    expect(wx).toBeCloseTo(5, 4);
    expect(wy).toBeCloseTo(40, 4);
  });
});
