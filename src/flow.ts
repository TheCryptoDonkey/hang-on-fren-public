// FREN FLOW — the visible skill chain that turns brave riding into score.
// Pure and mutable like scoring.ts: the game owns one state per run and feeds
// it clean overtakes, near misses, drafting and slingshots.

import { clamp } from './util.js';

export interface FlowState {
  value: number; // 0..100
  peak: number;
  hold: number; // seconds before decay resumes
}

export const FLOW_GAINS = {
  pickup: 5,
  overtake: 10,
  nearMiss: 18,
  slingshot: 22,
} as const;

const TIER_AT = [0, 20, 45, 70, 90] as const;
const LABELS = ['READY', 'WARM', 'HOT', 'WILD', 'LEGEND'] as const;
const TIER_MULT_STEP = 0.25;

/** The biggest action multiplier the meter pays (LEGEND tier). The claim
 *  service derives its score ceiling from this — keep it true to the maths
 *  in flowMultiplier, never hand-copied. */
export const MAX_FLOW_MULTIPLIER = 1 + (TIER_AT.length - 1) * TIER_MULT_STEP;

export function createFlow(): FlowState {
  return { value: 0, peak: 0, hold: 0 };
}

export function flowTier(state: FlowState): number {
  let tier = 0;
  for (let i = 1; i < TIER_AT.length; i += 1) {
    if (state.value >= TIER_AT[i]) tier = i;
  }
  return tier;
}

export function flowLabel(state: FlowState): string {
  return LABELS[flowTier(state)];
}

/** Action-score multiplier. Distance itself stays unmultiplied. */
export function flowMultiplier(state: FlowState): number {
  return 1 + flowTier(state) * TIER_MULT_STEP;
}

/** Add an authored action reward and hold the meter briefly before decay. */
export function gainFlow(state: FlowState, amount: number, hold = 1.45): boolean {
  const before = flowTier(state);
  state.value = clamp(state.value + Math.max(0, amount), 0, 100);
  state.peak = Math.max(state.peak, state.value);
  state.hold = Math.max(state.hold, hold);
  return flowTier(state) > before;
}

/** Drafting feeds flow continuously; otherwise the chain cools after its hold. */
export function tickFlow(state: FlowState, dt: number, draft = 0): void {
  if (dt <= 0) return;
  const wake = clamp(draft, 0, 1);
  if (wake > 0) {
    gainFlow(state, dt * (2 + wake * 5), 0.55);
    return;
  }
  state.hold = Math.max(0, state.hold - dt);
  if (state.hold <= 0) state.value = Math.max(0, state.value - dt * 6);
}

export function breakFlow(state: FlowState): void {
  state.value = 0;
  state.hold = 0;
}
