// Pure claim validation for the hang-on-fren score-claim service. The server
// signs the leaderboard event with the GAME key (like neon-sentinel/pallasite),
// so these plausibility checks are what stops a hand-rolled HTTP request from
// planting an impossible score on the board. Kept pure and node-free so it can
// be unit-tested with the rest of the suite.

import { GAME_ID } from '../src/scoring.js';

/** Milliseconds a finished run may lag before a claim is refused. Generous —
 *  a board run only submits after the callsign is typed. */
export const STALE_RUN_MS = 10 * 60 * 1000;
export const FUTURE_SLACK_MS = 60 * 1000;
/** The clock economy makes multi-hour runs impossible; an hour is generous. */
export const MAX_DURATION_S = 60 * 60;
/** Ten 2000 m stages + slack for the final frame past the line. */
export const MAX_DISTANCE_M = 21_000;
/** Top speed is 260 km/h ≈ 72 m/s; 80 m/s allows integrator slack. */
export const MAX_SPEED_M_PER_S = 80;

export interface ClaimInput {
  game: typeof GAME_ID;
  score: number;
  distance_m: number;
  /** In-game run time (the pause-free clock). */
  duration_s: number;
  /** Wall-clock ms — NIP-98 freshness ties the claim to the actual run. */
  started_at: number;
  finished_at: number;
  run_id: string;
  roses: number;
  overtakes: number;
  crashes: number;
  top_speed_kph: number;
  level: number;
  ended_by: 'time' | 'finish';
  player_name?: string;
  player_mode?: 'guest' | 'nostr';
  /** Bitcoin chain tip at run end — flavour, dropped (not refused) if implausible. */
  btc_block?: number;
  /** BTC price in US cents at run end — flavour, dropped (not refused) if implausible. */
  btc_usd_cents?: number;
}

export type ParseResult =
  | { ok: true; claim: ClaimInput }
  | { ok: false; status: 400 | 422; error: string; detail?: string };

export function parseClaim(body: unknown, now = Date.now()): ParseResult {
  if (!body || typeof body !== 'object') return { ok: false, status: 400, error: 'invalid_payload' };
  const value = body as Partial<ClaimInput>;
  if (value.game !== GAME_ID) return { ok: false, status: 422, error: 'wrong_game' };
  if (typeof value.run_id !== 'string' || value.run_id.length < 5 || value.run_id.length > 96) {
    return { ok: false, status: 422, error: 'invalid_run_id' };
  }
  const requiredNumbers: Array<keyof ClaimInput> = [
    'score', 'distance_m', 'duration_s', 'started_at', 'finished_at',
    'roses', 'overtakes', 'crashes', 'top_speed_kph', 'level',
  ];
  for (const key of requiredNumbers) {
    if (!Number.isInteger(value[key]) || Number(value[key]) < 0) {
      return { ok: false, status: 422, error: 'invalid_payload', detail: `${String(key)} must be a non-negative integer` };
    }
  }
  if (value.ended_by !== 'time' && value.ended_by !== 'finish') {
    return { ok: false, status: 422, error: 'invalid_payload', detail: 'ended_by must be time|finish' };
  }
  const claim = value as ClaimInput;

  if (claim.score <= 0) return { ok: false, status: 422, error: 'invalid_score' };
  if (claim.level < 1 || claim.level > 10) return { ok: false, status: 422, error: 'invalid_level' };
  if (claim.duration_s <= 0 || claim.duration_s > MAX_DURATION_S) return { ok: false, status: 422, error: 'invalid_duration' };
  if (claim.started_at >= claim.finished_at || claim.finished_at > now + FUTURE_SLACK_MS) {
    return { ok: false, status: 422, error: 'invalid_run_clock' };
  }
  if (now - claim.finished_at > STALE_RUN_MS) return { ok: false, status: 422, error: 'stale_run' };
  // Run time can never EXCEED the wall clock (pausing only stretches the wall
  // side), so the check is one-sided with a little skew slack.
  if (claim.duration_s * 1000 > claim.finished_at - claim.started_at + 5000) {
    return { ok: false, status: 422, error: 'duration_clock_mismatch' };
  }

  // Racer physics: you cannot cover ground faster than the bike's top speed,
  // and the journey is a fixed 20 km.
  if (claim.distance_m > MAX_DISTANCE_M) return { ok: false, status: 422, error: 'implausible_distance' };
  if (claim.distance_m > claim.duration_s * MAX_SPEED_M_PER_S) {
    return { ok: false, status: 422, error: 'implausible_distance' };
  }
  if (claim.top_speed_kph > 400) return { ok: false, status: 422, error: 'implausible_speed' };

  // Score ceiling: distance points dominate (~1/m, 1.5× on degen); pickups,
  // overtakes, streak multipliers and the finish time-bonus ride on top. This
  // is deliberately loose — it only has to make nonsense claims impossible,
  // not price every run exactly.
  const plausibleScore = 10_000 + claim.distance_m * 4 + claim.duration_s * 800;
  if (claim.score > plausibleScore) return { ok: false, status: 422, error: 'implausible_score' };

  // Chain-state flavour: keep only sane values so nonsense never reaches the
  // signed event, but never refuse a legitimate score over decoration.
  claim.btc_block = plausibleFlavourInt(claim.btc_block, 100_000_000);
  claim.btc_usd_cents = plausibleFlavourInt(claim.btc_usd_cents, 10_000_000_000);

  return { ok: true, claim };
}

function plausibleFlavourInt(value: unknown, max: number): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= max
    ? value
    : undefined;
}

export function cleanPlayerName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.replace(/\s+/g, ' ').trim().slice(0, 32);
  return clean || null;
}
