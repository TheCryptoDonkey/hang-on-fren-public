import { describe, it, expect } from 'vitest';
import { createFlick, updateFlick, FLICK } from './flick.js';

const DT = 1 / 240;

/** Feed `seconds` of a held steering direction; returns any slide it fired. */
function hold(f: ReturnType<typeof createFlick>, steer: number, seconds: number): number {
  let fired = 0;
  for (let t = 0; t < seconds - 1e-9; t += DT) {
    const out = updateFlick(f, steer, DT);
    if (out !== 0) fired = out;
  }
  return fired;
}

describe('the flick', () => {
  it('fires a right slide on hold-right, stab-left, hold-right', () => {
    const f = createFlick();
    expect(hold(f, 1, 0.3)).toBe(0); // committing to the corner
    expect(hold(f, -1, 0.1)).toBe(0); // the stab — nothing yet
    expect(hold(f, 1, 0.05)).toBe(1); // pinned back in → slide RIGHT
  });

  it('fires a left slide on the mirror gesture', () => {
    const f = createFlick();
    hold(f, -1, 0.3);
    hold(f, 1, 0.1);
    expect(hold(f, -1, 0.05)).toBe(-1);
  });

  it('tolerates a beat of neutral between the stab and the re-press', () => {
    // This is the keyboard case: the stab drops the corner key, so there is
    // always a neutral frame before it is pressed again.
    const f = createFlick();
    hold(f, 1, 0.25);
    hold(f, -1, 0.08);
    hold(f, 0, 0.1);
    expect(hold(f, 1, 0.05)).toBe(1);
  });

  it('does NOT fire when the rider simply changes direction', () => {
    const f = createFlick();
    hold(f, 1, 0.4); // a right-hander
    hold(f, -1, 0.6); // ...then a committed left-hander
    expect(hold(f, 1, 0.4)).toBe(0); // and back right: still no slide
  });

  it('does NOT fire if the counter-stab is held too long', () => {
    const f = createFlick();
    hold(f, 1, 0.3);
    hold(f, -1, FLICK.maxCounter + 0.06);
    expect(hold(f, 1, 0.05)).toBe(0);
  });

  it('does NOT fire if the corner was never committed to first', () => {
    const f = createFlick();
    hold(f, 1, 0.04); // barely a brush of the key
    hold(f, -1, 0.08);
    expect(hold(f, 1, 0.05)).toBe(0);
  });

  it('does NOT fire if the rider dawdles past the return window', () => {
    const f = createFlick();
    hold(f, 1, 0.3);
    hold(f, -1, 0.08);
    hold(f, 0, FLICK.returnWindow + 0.1);
    expect(hold(f, 1, 0.1)).toBe(0);
  });

  it('never fires from ordinary cornering (one sustained direction)', () => {
    const f = createFlick();
    let fired = 0;
    for (let i = 0; i < 200; i += 1) if (updateFlick(f, 1, DT) !== 0) fired += 1;
    expect(fired).toBe(0);
  });

  it('never fires from mashing one direction', () => {
    const f = createFlick();
    let fired = 0;
    for (let i = 0; i < 40; i += 1) {
      if (hold(f, 1, 0.05) !== 0) fired += 1;
      if (hold(f, 0, 0.05) !== 0) fired += 1;
    }
    expect(fired).toBe(0);
  });

  it('behaves the same at 30 Hz as at 240 Hz', () => {
    const slow = createFlick();
    const step = 1 / 30;
    let fired = 0;
    for (let t = 0; t < 0.3; t += step) fired = updateFlick(slow, 1, step) || fired;
    for (let t = 0; t < 0.1; t += step) fired = updateFlick(slow, -1, step) || fired;
    for (let t = 0; t < 0.1; t += step) fired = updateFlick(slow, 1, step) || fired;
    expect(fired).toBe(1);
  });
});
