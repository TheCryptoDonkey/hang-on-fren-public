import { describe, it, expect } from 'vitest';
import { createTimer, tickTimer, addRoseTime, addCanTime, timerExpired, timerUrgency, DEFAULT_TIMER } from './timer.js';

const CFG = { startTime: 40, roseBonus: 4, canBonus: 21, maxTime: 60 };

describe('timer', () => {
  it('starts clamped to the configured start time', () => {
    expect(createTimer().timeLeft).toBe(DEFAULT_TIMER.startTime);
  });

  it('ticks down and reports the frame it hits zero exactly once', () => {
    const t = createTimer({ ...CFG, startTime: 1 });
    expect(tickTimer(t, 0.5)).toBe(false);
    expect(tickTimer(t, 0.6)).toBe(true); // crosses zero
    expect(t.timeLeft).toBe(0);
    expect(tickTimer(t, 0.1)).toBe(false); // already dead
    expect(timerExpired(t)).toBe(true);
  });

  it('adds rose time but never above the ceiling', () => {
    const t = createTimer({ ...CFG, startTime: 58 });
    expect(addRoseTime(t, { ...CFG, startTime: 58 })).toBe(2);
    expect(t.timeLeft).toBe(60);
    expect(t.bonusBanked).toBe(2);
  });

  it('a petrol can adds 21 seconds (clamped to the ceiling)', () => {
    const t = createTimer({ ...CFG, startTime: 10 });
    expect(addCanTime(t, CFG)).toBe(21);
    expect(t.timeLeft).toBe(31);
    // near the ceiling it only tops up to maxTime
    t.timeLeft = 50;
    expect(addCanTime(t, CFG)).toBe(10);
    expect(t.timeLeft).toBe(60);
  });

  it('urgency ramps only under the threshold', () => {
    const t = createTimer({ ...CFG, startTime: 10 });
    expect(timerUrgency(t)).toBe(0);
    t.timeLeft = 3;
    expect(timerUrgency(t, 6)).toBeCloseTo(0.5, 5);
    t.timeLeft = 0;
    expect(timerUrgency(t, 6)).toBe(1);
  });
});
