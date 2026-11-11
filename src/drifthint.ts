// The in-run drift lesson. The title card names the flick, but a rider who
// skipped it never learns the move that makes the game. The first time a run
// settles into a real bend, one short prompt says how, then it stays quiet for
// good once a drift has been completed. Presentation only: it reads the bend and
// the clock, and touches no physics, scoring or timers.
//
// Persisted the same way as progress.ts: a thin kv wrapper, try/catch on both
// sides, a versioned key.

import { kv } from './kv.js';

const TAUGHT_KEY = 'hangonfren:drift-taught:v1';

export function loadDriftTaught(): boolean {
  try {
    return kv.getItem(TAUGHT_KEY) === '1';
  } catch {
    return false;
  }
}

export function saveDriftTaught(): void {
  try {
    kv.setItem(TAUGHT_KEY, '1');
  } catch {
    /* private mode: the prompt may show again next visit */
  }
}

export const DRIFT_HINT = {
  /** Curvature that counts as a bend (the warm-up sweepers are 4, an easy kink is 2). */
  minCurve: 3,
  /** Seconds of one continuous bend before it counts as sustained. */
  bendHold: 0.7,
  /** Fraction of top speed needed for the tyres to let go (road.ts driftEntrySpeed). */
  minSpeedFrac: 0.5,
  /** Quiet opening: the rival card and the intro popups own these seconds. */
  minRunTime: 6,
  /** How long the prompt stays up. */
  ttl: 3.2,
} as const;

export interface BendHold {
  /** Seconds the current bend has run (0 on the straight). */
  time: number;
  /** Its direction, -1 left or +1 right (0 on the straight). */
  dir: number;
}

export function createBendHold(): BendHold {
  return { time: 0, dir: 0 };
}

export function resetBendHold(b: BendHold): void {
  b.time = 0;
  b.dir = 0;
}

/** Advance the bend clock one step. A flip of direction starts a new bend. */
export function tickBendHold(b: BendHold, curve: number, speedFrac: number, dt: number): void {
  const dir = Math.abs(curve) >= DRIFT_HINT.minCurve && speedFrac >= DRIFT_HINT.minSpeedFrac
    ? Math.sign(curve)
    : 0;
  if (dir === 0 || dir !== b.dir) {
    b.dir = dir;
    b.time = 0;
    return;
  }
  b.time += dt;
}

export interface DriftHintContext {
  /** A drift has been completed on this device before. */
  taught: boolean;
  /** The prompt already showed in this run. */
  shownThisRun: boolean;
  runTime: number;
  /** Seconds left of the rival intro card and of the rival result card. */
  rivalIntro: number;
  rivalResultTime: number;
  /** Any popup or banner is up, or a wipeout is in progress. */
  busy: boolean;
  /** Sliding now, so the rider plainly knows. */
  drifting: boolean;
  bend: BendHold;
}

export function shouldShowDriftHint(c: DriftHintContext): boolean {
  if (c.taught || c.shownThisRun || c.busy || c.drifting) return false;
  if (c.runTime < DRIFT_HINT.minRunTime) return false;
  if (c.rivalIntro > 0 || c.rivalResultTime > 0) return false;
  return c.bend.time >= DRIFT_HINT.bendHold;
}

/** The prompt: the title's own wording, then how to do it. One popup, so a short
 *  phone never holds the second half back behind other popups. */
export function driftHintText(touch: boolean): string {
  return touch
    ? 'FLICK TO DRIFT  ·  TAP AWAY, THEN BACK'
    : 'FLICK THE BARS TO DRIFT  ·  OTHER ARROW, THEN BACK';
}
