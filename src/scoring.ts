// Score accrual + the end-of-run summary. Kept pure so scoring rules are
// unit-tested. `buildScoreEvent()` is the deliberate seam for the future
// Nostr layer: today it just shapes the data; later a signer publishes it as a
// kind 30762 event exactly like neon-sentinel (see docs spec, "Online scope").

export interface ScoreState {
  score: number;
  /** Difficulty-mode points multiplier — braver roads pay better. */
  mult: number;
  /** Metres travelled — also the primary skill signal. */
  distance: number;
  fuel: number; // petrol cans (the common pickup)
  roses: number; // rare special roses
  overtakes: number;
  nearMisses: number;
  crashes: number;
  /** Longest streak of pickups grabbed without a crash in between. */
  bestRoseStreak: number;
  roseStreak: number;
  topSpeed: number;
}

// Points. Distance dominates (skill-first), pickups/overtakes are the spice.
const POINTS_PER_METRE = 1;
const POINTS_PER_FUEL = 120;
const POINTS_PER_ROSE = 400; // rare special
const POINTS_PER_OVERTAKE = 250;
const POINTS_PER_NEAR_MISS = 60;

export function createScore(mult = 1): ScoreState {
  return {
    score: 0,
    mult,
    distance: 0,
    fuel: 0,
    roses: 0,
    overtakes: 0,
    nearMisses: 0,
    crashes: 0,
    bestRoseStreak: 0,
    roseStreak: 0,
    topSpeed: 0,
  };
}

/** Bank distance travelled this frame. `speedKph` feeds the top-speed stat. */
export function addDistance(state: ScoreState, metres: number, speedKph: number): void {
  if (metres <= 0) return;
  state.distance += metres;
  state.score += metres * POINTS_PER_METRE * state.mult;
  if (speedKph > state.topSpeed) state.topSpeed = speedKph;
}

function bumpStreak(state: ScoreState): number {
  state.roseStreak += 1;
  if (state.roseStreak > state.bestRoseStreak) state.bestRoseStreak = state.roseStreak;
  // Streak multiplier rewards clean pickup runs without over-scaling.
  return 1 + Math.min(state.roseStreak - 1, 9) * 0.1;
}

/** A petrol can (the common pickup) grants points + tops up the clock. */
export function addFuel(state: ScoreState): void {
  state.fuel += 1;
  const streakBonus = bumpStreak(state);
  state.score += Math.round(POINTS_PER_FUEL * streakBonus * state.mult);
}

/** A rare rose grants big points (and a nitro boost, handled in main). */
export function addRose(state: ScoreState): void {
  state.roses += 1;
  const streakBonus = bumpStreak(state);
  state.score += Math.round(POINTS_PER_ROSE * streakBonus * state.mult);
}

/** A special treat pickup (cake, meme, ATH…): points, streak-multiplied. */
export function addBonus(state: ScoreState, points: number): void {
  const streakBonus = bumpStreak(state);
  state.score += Math.round(points * streakBonus * state.mult);
}

/** A troll pickup (fiat): shaves score and breaks the streak. */
export function penalise(state: ScoreState, points: number): void {
  state.score = Math.max(0, state.score - points);
  state.roseStreak = 0;
}

/** A skill stunt (slipstream slingshot): mode-multiplied points, streak-neutral. */
export function addStuntBonus(state: ScoreState, points: number): void {
  state.score += Math.round(points * state.mult);
}

export function addOvertake(state: ScoreState): void {
  state.overtakes += 1;
  state.score += POINTS_PER_OVERTAKE * state.mult;
}

export function addNearMiss(state: ScoreState): void {
  state.nearMisses += 1;
  state.score += POINTS_PER_NEAR_MISS * state.mult;
}

export function registerCrash(state: ScoreState): void {
  state.crashes += 1;
  state.roseStreak = 0;
}

export interface RunSummary {
  score: number;
  distanceM: number;
  fuel: number;
  roses: number;
  overtakes: number;
  nearMisses: number;
  crashes: number;
  bestRoseStreak: number;
  topSpeedKph: number;
  durationS: number;
  endedBy: 'time' | 'crashes';
}

export function summarise(state: ScoreState, durationS: number, endedBy: 'time' | 'crashes'): RunSummary {
  return {
    score: Math.round(state.score),
    distanceM: Math.round(state.distance),
    fuel: state.fuel,
    roses: state.roses,
    overtakes: state.overtakes,
    nearMisses: state.nearMisses,
    crashes: state.crashes,
    bestRoseStreak: state.bestRoseStreak,
    topSpeedKph: Math.round(state.topSpeed),
    durationS: Math.round(durationS),
    endedBy,
  };
}

/**
 * Seam for the future Nostr leaderboard. Shapes a run into the tag list a
 * kind 30762 score event would carry. Nothing is signed or published today.
 */
export function buildScoreEvent(summary: RunSummary, playerPubkey = 'guest'): {
  kind: number;
  tags: string[][];
} {
  return {
    kind: 30762,
    tags: [
      ['d', `hangonfren:${playerPubkey}:run`],
      ['game', 'hangonfren'],
      ['score', String(summary.score)],
      ['state', 'final'],
      ['distance', String(summary.distanceM)],
      ['roses', String(summary.roses)],
      ['overtakes', String(summary.overtakes)],
      ['crashes', String(summary.crashes)],
      ['duration', String(summary.durationS)],
      ['ended_by', summary.endedBy],
      ['t', 'arcade'],
      ['t', 'racer'],
      ['t', 'hangonfren'],
    ],
  };
}
