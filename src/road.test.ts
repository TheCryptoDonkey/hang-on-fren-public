import { describe, it, expect } from 'vitest';
import { buildTrack, decorateTrack, findSegment, createPlayer, updatePlayer, ROAD, DEFAULT_TUNING } from './road.js';

describe('road', () => {
  it('builds a seamless loop whose ends are flat', () => {
    const t = buildTrack();
    expect(t.segments.length).toBeGreaterThan(5000);
    expect(t.length).toBe(t.segments.length * ROAD.segmentLength);
    // The seam must be flat so wrapping player.z is invisible.
    expect(Math.abs(t.segments[t.segments.length - 1].p2.world.y)).toBeLessThan(1);
    expect(t.segments[0].curve).toBe(0);
  });

  it('authors the long left-to-hard-transition-to-long-right Billion Bend', () => {
    const t = buildTrack();
    const feature = t.features['billion-bend'];
    const bend = t.segments.slice(feature.startIndex, feature.endIndex + 1);
    expect(bend.length).toBeGreaterThan(1000); // more than 2 km of continuous road
    expect(bend.filter(s => s.curve < -2).length).toBeGreaterThan(450);
    expect(bend.filter(s => s.curve > 2).length).toBeGreaterThan(400);
    expect(Math.min(...bend.map(s => s.curve))).toBeLessThanOrEqual(-10.9);
    expect(Math.max(...bend.map(s => s.curve))).toBeGreaterThanOrEqual(6.4);
  });

  it('puts hard hidden turns immediately beyond two self-contained summits', () => {
    const t = buildTrack();
    for (const name of ['blind-summit-west', 'blind-summit-east'] as const) {
      const feature = t.features[name];
      const summit = t.segments.slice(feature.startIndex, feature.endIndex + 1);
      const startY = summit[0].p1.world.y;
      const peakOffset = summit.reduce((best, s, i, all) => s.p2.world.y > all[best].p2.world.y ? i : best, 0);
      expect(summit[peakOffset].p2.world.y - startY).toBeGreaterThan(6000);
      expect(summit.slice(peakOffset + 1, peakOffset + 35).some(s => Math.abs(s.curve) >= 6.5)).toBe(true);
      expect(Math.abs(summit[summit.length - 1].p2.world.y - startY)).toBeLessThan(1);
    }
  });

  it('gives each meme billboard a clear sight-line', () => {
    const t = buildTrack();
    decorateTrack(t, ['sign-0'], ['billboard-test'], 42);
    const billboardIndices = t.segments
      .filter(s => s.scenery.some(item => item.name === 'billboard-test'))
      .map(s => s.index);
    expect(billboardIndices.length).toBeGreaterThan(10);
    for (const index of billboardIndices) {
      expect(t.segments[index].scenery).toHaveLength(1);
      for (let d = -20; d <= 20; d += 1) {
        if (d === 0) continue;
        const nearby = t.segments[(index + d + t.segments.length) % t.segments.length];
        expect(nearby.scenery).toHaveLength(0);
      }
    }
  });

  it('finds the segment for a z and wraps out-of-range z', () => {
    const t = buildTrack();
    expect(findSegment(t, 0).index).toBe(0);
    expect(findSegment(t, ROAD.segmentLength * 1.5).index).toBe(1);
    expect(findSegment(t, t.length + ROAD.segmentLength * 2).index).toBe(2); // wrapped
  });

  it('advances the player under throttle and wraps around the loop', () => {
    const t = buildTrack();
    const p = createPlayer();
    const input = { left: false, right: false, throttle: true, brake: false };
    for (let i = 0; i < 600; i += 1) updatePlayer(p, t, input, 1 / 60, DEFAULT_TUNING);
    expect(p.speed).toBeGreaterThan(0);
    expect(p.z).toBeGreaterThanOrEqual(0);
    expect(p.z).toBeLessThan(t.length);
  });

  it('caps speed at maxSpeed and keeps x within the off-road bound', () => {
    const t = buildTrack();
    const p = createPlayer();
    const input = { left: true, right: false, throttle: true, brake: false };
    for (let i = 0; i < 2000; i += 1) updatePlayer(p, t, input, 1 / 60, DEFAULT_TUNING);
    expect(p.speed).toBeLessThanOrEqual(p.maxSpeed + 1e-6);
    expect(p.x).toBeGreaterThanOrEqual(-2.4001);
    expect(p.offRoad).toBe(true);
  });
});
