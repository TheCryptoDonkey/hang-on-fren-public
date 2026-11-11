import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  DRIFT_HINT, createBendHold, driftHintText, loadDriftTaught, saveDriftTaught,
  shouldShowDriftHint, tickBendHold, type DriftHintContext,
} from './drifthint.js';

const store = new Map<string, string>();
const fakeStorage = {
  getItem: (k: string): string | null => store.get(k) ?? null,
  setItem: (k: string, v: string): void => void store.set(k, v),
};

function run(curve: number, seconds: number, speed = 1) {
  const b = createBendHold();
  for (let i = 0; i < Math.round(seconds * 240); i += 1) tickBendHold(b, curve, speed, 1 / 240);
  return b;
}

function ctx(over: Partial<DriftHintContext> = {}): DriftHintContext {
  const bend = run(4, 1);
  return {
    taught: false, shownThisRun: false, runTime: 10, rivalIntro: 0, rivalResultTime: 0,
    busy: false, drifting: false, bend, ...over,
  };
}

describe('drift hint: bend clock', () => {
  it('stays at zero on a straight or a slight kink', () => {
    expect(run(0, 2).time).toBe(0);
    expect(run(DRIFT_HINT.minCurve - 0.1, 2).time).toBe(0);
  });

  it('counts a sustained bend', () => {
    expect(run(4, 1).time).toBeGreaterThan(0.95);
    expect(run(-4, 1).dir).toBe(-1);
  });

  it('does not count below drift-entry speed', () => {
    expect(run(4, 2, DRIFT_HINT.minSpeedFrac - 0.1).time).toBe(0);
  });

  it('restarts when the bend flips or straightens', () => {
    const b = run(4, 1);
    tickBendHold(b, -4, 1, 1 / 240);
    expect(b.time).toBe(0);
    expect(b.dir).toBe(-1);
    tickBendHold(b, 0, 1, 1 / 240);
    expect(b.dir).toBe(0);
  });
});

describe('drift hint: when to show', () => {
  it('shows on a sustained bend after the opening', () => {
    expect(shouldShowDriftHint(ctx())).toBe(true);
  });

  it('waits for the bend to be sustained', () => {
    expect(shouldShowDriftHint(ctx({ bend: run(4, DRIFT_HINT.bendHold * 0.5) }))).toBe(false);
  });

  it('stays out of the opening seconds', () => {
    expect(shouldShowDriftHint(ctx({ runTime: DRIFT_HINT.minRunTime - 0.1 }))).toBe(false);
  });

  it('never stacks on the rival cards, other popups, a wipeout or a slide', () => {
    expect(shouldShowDriftHint(ctx({ rivalIntro: 0.5 }))).toBe(false);
    expect(shouldShowDriftHint(ctx({ rivalResultTime: 2 }))).toBe(false);
    expect(shouldShowDriftHint(ctx({ busy: true }))).toBe(false);
    expect(shouldShowDriftHint(ctx({ drifting: true }))).toBe(false);
  });

  it('shows once per run and never after a drift has been learned', () => {
    expect(shouldShowDriftHint(ctx({ shownThisRun: true }))).toBe(false);
    expect(shouldShowDriftHint(ctx({ taught: true }))).toBe(false);
  });
});

describe('drift hint: wording', () => {
  it('reuses the title wording for each input', () => {
    expect(driftHintText(true).startsWith('FLICK TO DRIFT')).toBe(true);
    expect(driftHintText(false).startsWith('FLICK THE BARS TO DRIFT')).toBe(true);
  });

  it('names the other arrow on both inputs', () => {
    expect(driftHintText(true)).toContain('OTHER ARROW, THEN BACK');
    expect(driftHintText(false)).toContain('OTHER ARROW, THEN BACK');
  });
});

describe('drift hint: persistence', () => {
  beforeEach(() => {
    store.clear();
    (globalThis as { localStorage?: unknown }).localStorage = fakeStorage;
  });
  afterEach(() => {
    delete (globalThis as { localStorage?: unknown }).localStorage;
  });

  it('starts untaught and remembers a completed drift', () => {
    expect(loadDriftTaught()).toBe(false);
    saveDriftTaught();
    expect(loadDriftTaught()).toBe(true);
    expect(store.get('hangonfren:drift-taught:v1')).toBe('1');
  });

  it('survives storage that throws', () => {
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: () => { throw new Error('denied'); },
      setItem: () => { throw new Error('denied'); },
    };
    expect(loadDriftTaught()).toBe(false);
    expect(() => saveDriftTaught()).not.toThrow();
  });
});
