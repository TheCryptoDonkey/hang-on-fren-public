// Deterministic three-region rival pacing. The rival gets a personality-sized
// rhythm and bounded catch-up correction, never teleporting or inheriting the
// player's turbo. World rendering/collision is handled by world.ts.

import { clamp } from './util.js';

export const RIVAL_TOUR_FINISH_M = 12_600;
export const RIVAL_START_AHEAD_M = 72;

export interface RivalProgress {
  distanceM: number;
  speedMps: number;
  elapsedS: number;
  finishTimeS: number | null;
}

export interface RivalFrame {
  dt: number;
  playerDistanceM: number;
  maxSpeedMps: number;
  difficultySpeedMul?: number;
}

export function createRivalProgress(maxSpeedMps: number, startAheadM = RIVAL_START_AHEAD_M): RivalProgress {
  return {
    distanceM: startAheadM,
    speedMps: maxSpeedMps * 0.58,
    elapsedS: 0,
    finishTimeS: null,
  };
}

/** Positive means the Fren is ahead; negative means the player leads. */
export function rivalGapM(progress: RivalProgress, playerDistanceM: number): number {
  return progress.distanceM - playerDistanceM;
}

export function updateRival(progress: RivalProgress, frame: RivalFrame): void {
  const dt = Math.max(0, frame.dt);
  if (dt <= 0 || progress.finishTimeS !== null) return;

  const maxSpeed = Math.max(1, frame.maxSpeedMps);
  const difficulty = frame.difficultySpeedMul ?? 1;
  const journey = clamp(progress.distanceM / RIVAL_TOUR_FINISH_M, 0, 1);
  const gap = rivalGapM(progress, frame.playerDistanceM);

  // Classic is beatable by a clean rider. Cruise eases the pace and Degen
  // sharpens it through the already-selected traffic speed multiplier.
  const base = 0.8 + journey * 0.035 + (difficulty - 1) * 0.42;
  const catchup = clamp(-gap / 650, -0.055, 0.055);
  const rhythm = Math.sin(progress.distanceM * 0.0042) * 0.018
    + Math.sin(progress.elapsedS * 0.37 + 0.8) * 0.009;
  const target = maxSpeed * clamp(base + catchup + rhythm, 0.72, 0.91);
  const response = 1 - Math.exp(-dt * 1.35);
  progress.speedMps += (target - progress.speedMps) * response;

  const before = progress.distanceM;
  const after = before + progress.speedMps * dt;
  if (after >= RIVAL_TOUR_FINISH_M) {
    const fraction = clamp((RIVAL_TOUR_FINISH_M - before) / Math.max(0.0001, after - before), 0, 1);
    progress.finishTimeS = progress.elapsedS + dt * fraction;
    progress.distanceM = RIVAL_TOUR_FINISH_M;
    progress.speedMps = 0;
  } else {
    progress.distanceM = after;
  }
  progress.elapsedS += dt;
}

export interface RivalResult {
  won: boolean;
  deltaS: number;
}

export function resolveRivalResult(progress: RivalProgress, playerFinishTimeS: number): RivalResult {
  if (progress.finishTimeS === null) {
    const remaining = Math.max(0, RIVAL_TOUR_FINISH_M - progress.distanceM);
    const estimate = remaining / Math.max(1, progress.speedMps);
    return { won: true, deltaS: estimate };
  }
  return { won: false, deltaS: Math.max(0, playerFinishTimeS - progress.finishTimeS) };
}
