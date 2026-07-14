import { describe, expect, it } from 'vitest';
import { createRivalProgress, resolveRivalResult, RIVAL_TOUR_FINISH_M, rivalGapM, updateRival } from './rival.js';

describe('Fren rival tour', () => {
  it('runs a deterministic, bounded three-region race', () => {
    const a = createRivalProgress(88.9);
    const b = createRivalProgress(88.9);
    let playerM = 0;
    for (let i = 0; i < 60 * 180; i += 1) {
      playerM += 78 * (1 / 60);
      const frame = { dt: 1 / 60, playerDistanceM: playerM, maxSpeedMps: 88.9 };
      updateRival(a, frame);
      updateRival(b, frame);
    }
    expect(a).toEqual(b);
    expect(a.distanceM).toBe(RIVAL_TOUR_FINISH_M);
    expect(a.finishTimeS).not.toBeNull();
  });

  it('uses only bounded pace correction when either rider opens a gap', () => {
    const ahead = createRivalProgress(90);
    const behind = createRivalProgress(90);
    updateRival(ahead, { dt: 1, playerDistanceM: -500, maxSpeedMps: 90 });
    updateRival(behind, { dt: 1, playerDistanceM: 500, maxSpeedMps: 90 });
    expect(ahead.speedMps).toBeGreaterThan(90 * 0.58);
    expect(behind.speedMps).toBeLessThanOrEqual(90 * 0.91);
    expect(behind.speedMps).toBeGreaterThan(ahead.speedMps);
  });

  it('reports the gap and resolves wins without inventing a teleport', () => {
    const rival = createRivalProgress(80, 50);
    expect(rivalGapM(rival, 20)).toBe(30);
    rival.distanceM = RIVAL_TOUR_FINISH_M - 160;
    rival.speedMps = 80;
    const win = resolveRivalResult(rival, 150);
    expect(win.won).toBe(true);
    expect(win.deltaS).toBeCloseTo(2);
    rival.finishTimeS = 147.5;
    const loss = resolveRivalResult(rival, 150);
    expect(loss).toEqual({ won: false, deltaS: 2.5 });
  });
});
