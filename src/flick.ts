// The FLICK: the OutRun way to ASK for a powerslide.
//
// Real riders unsettle a bike before a fast corner by stabbing the bars the
// WRONG way — a counter-steer that breaks the rear loose — then pinning it back
// into the turn. That is the input this module listens for:
//
//     hold RIGHT  →  stab LEFT  →  hold RIGHT again   ⇒  power slide right
//
// It reads only the net steer DIRECTION each step (-1 left / 0 / +1 right), so
// it works identically for keyboard, touch and gamepad. It is deliberately a
// *gesture*, not a button: you cannot fall into it by cornering normally (that
// is one sustained direction), and holding the opposite way for a real beat is
// read as a genuine change of direction, never a flick. Pure and
// framerate-independent so it unit-tests and behaves the same at 30 and 240 Hz.
//
// It only DETECTS the gesture. The slide it asks for is the existing drift
// physics in road.ts — the flick is just a second, more expressive way in
// alongside brake-into-turn.

export const FLICK = {
  /** You must be committed to the corner before the stab counts. */
  minHold: 0.11,
  /** A stab shorter than this is switch bounce, not a flick. */
  minCounter: 0.02,
  /** Hold the opposite way longer than this and you MEANT it — a genuine change
   *  of direction, so no slide. */
  maxCounter: 0.26,
  /** After the stab, how long you have to pin it back into the corner. */
  returnWindow: 0.3,
  /** Coasting at neutral this long lets go of the whole gesture. */
  neutralGrace: 0.22,
} as const;

export interface FlickState {
  /** The direction currently being held — the corner you are in. */
  dir: number;
  /** Seconds held in `dir` before the stab. */
  hold: number;
  /** Seconds of opposite-direction stab so far (0 = not stabbing). */
  counter: number;
  /** Seconds left to pin it back after the stab ends. */
  window: number;
  /** Seconds spent at neutral. */
  neutral: number;
}

export function createFlick(): FlickState {
  return { dir: 0, hold: 0, counter: 0, window: 0, neutral: 0 };
}

export function resetFlick(f: FlickState): void {
  f.dir = 0;
  f.hold = 0;
  f.counter = 0;
  f.window = 0;
  f.neutral = 0;
}

/** Forget the stab, but stay committed to the corner we were already holding. */
function forgetStab(f: FlickState): void {
  f.counter = 0;
  f.window = 0;
}

/**
 * Feed one step of steering (-1 left, 0 neutral, +1 right).
 * Returns the slide direction (-1 / +1) on the step the flick completes, else 0.
 */
export function updateFlick(f: FlickState, steer: number, dt: number): number {
  if (steer === 0) {
    f.neutral += dt;
    if (f.window > 0) {
      // Mid-gesture: a beat of neutral between the stab and the re-press is
      // normal (on a keyboard the corner key is dropped by the stab, so there is
      // always a neutral frame), so the return window keeps running rather than
      // cancelling.
      f.window -= dt;
      if (f.window <= 0) forgetStab(f);
    } else if (f.neutral > FLICK.neutralGrace) {
      resetFlick(f);
    }
    return 0;
  }
  f.neutral = 0;

  if (f.dir === 0) {
    f.dir = steer;
    f.hold = dt;
    return 0;
  }

  if (steer === f.dir) {
    // Back into the corner. If that follows a real stab, the tyres let go.
    if (f.counter >= FLICK.minCounter) {
      const dir = f.dir;
      resetFlick(f);
      f.dir = dir; // still holding this way — keep the corner, drop the gesture
      return dir;
    }
    forgetStab(f);
    f.hold += dt;
    return 0;
  }

  // Steering the OPPOSITE way to the corner we were holding: the stab.
  if (f.hold >= FLICK.minHold) {
    f.counter += dt;
    f.window = FLICK.returnWindow;
    if (f.counter > FLICK.maxCounter) {
      // Held it too long — this is a genuine change of direction, not a flick.
      f.dir = steer;
      f.hold = f.counter;
      forgetStab(f);
    }
    return 0;
  }

  // Never committed to the first direction — just treat this as the new corner.
  f.dir = steer;
  f.hold = dt;
  forgetStab(f);
  return 0;
}
