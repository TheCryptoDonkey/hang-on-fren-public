// The always-ticking clock and the rose time-economy. One of the two ways to
// die (the other is running out of lives). Pure and unit-tested — the render
// loop only reads `timeLeft` and calls tick()/addRose().

import { clamp } from './util.js';

export interface TimerConfig {
  /** Seconds on the clock at the start of a run. */
  startTime: number;
  /** Seconds granted per rose picked up. */
  roseBonus: number;
  /** Seconds granted by a petrol can — the common top-up (the 21s numerology). */
  canBonus: number;
  /** Hard ceiling so a rose streak can't bank an unkillable buffer. */
  maxTime: number;
}

export interface TimerState {
  timeLeft: number;
  /** Total seconds ever gained from roses this run (for stats). */
  bonusBanked: number;
}

export const DEFAULT_TIMER: TimerConfig = {
  startTime: 42,
  roseBonus: 4,
  canBonus: 21,
  maxTime: 60,
};

export function createTimer(config: TimerConfig = DEFAULT_TIMER): TimerState {
  return { timeLeft: clamp(config.startTime, 0, config.maxTime), bonusBanked: 0 };
}

/** Advance the clock. Returns true on the frame the timer hits zero. */
export function tickTimer(state: TimerState, dt: number): boolean {
  if (state.timeLeft <= 0) return false;
  state.timeLeft = Math.max(0, state.timeLeft - dt);
  return state.timeLeft === 0;
}

/** Grant a fixed number of seconds, clamped to the ceiling. Returns seconds added. */
export function addTime(state: TimerState, seconds: number, config: TimerConfig = DEFAULT_TIMER): number {
  const before = state.timeLeft;
  state.timeLeft = clamp(state.timeLeft + seconds, 0, config.maxTime);
  const added = state.timeLeft - before;
  state.bonusBanked += added;
  return added;
}

/** Grant rose time, clamped to the ceiling. Returns seconds actually added. */
export function addRoseTime(state: TimerState, config: TimerConfig = DEFAULT_TIMER): number {
  return addTime(state, config.roseBonus, config);
}

/** Grant a petrol-can top-up (+canBonus). Returns seconds actually added. */
export function addCanTime(state: TimerState, config: TimerConfig = DEFAULT_TIMER): number {
  return addTime(state, config.canBonus, config);
}

export function timerExpired(state: TimerState): boolean {
  return state.timeLeft <= 0;
}

/** 0..1 urgency for HUD flashing/ticking; ramps up under `threshold` seconds. */
export function timerUrgency(state: TimerState, threshold = 6): number {
  if (state.timeLeft >= threshold) return 0;
  return clamp(1 - state.timeLeft / threshold, 0, 1);
}
