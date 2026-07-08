import { describe, it, expect } from 'vitest';
import { buildTrack, findSegment, createPlayer, updatePlayer, ROAD, DEFAULT_TUNING } from './road.js';

describe('road', () => {
  it('builds a seamless loop whose ends are flat', () => {
    const t = buildTrack();
    expect(t.segments.length).toBeGreaterThan(500);
    expect(t.length).toBe(t.segments.length * ROAD.segmentLength);
    // The seam must be flat so wrapping player.z is invisible.
    expect(Math.abs(t.segments[t.segments.length - 1].p2.world.y)).toBeLessThan(1);
    expect(t.segments[0].curve).toBe(0);
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
