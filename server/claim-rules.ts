// Pure claim validation for the hang-on-fren score-claim service. The server
// signs the leaderboard event with the GAME key (like neon-sentinel/pallasite),
// so these plausibility checks are what stops a hand-rolled HTTP request from
// planting an impossible score on the board. Kept pure and node-free so it can
// be unit-tested with the rest of the suite.

import { GAME_ID } from '../src/scoring.js';
import { FINISH_M } from '../src/stages.js';

/** Milliseconds a finished run may lag before a claim is refused. Generous —
 *  a board run only submits after the callsign is typed. */
export const STALE_RUN_MS = 10 * 60 * 1000;
export const FUTURE_SLACK_MS = 60 * 1000;
/** The clock economy makes multi-hour runs impossible; an hour is generous. */
export const MAX_DURATION_S = 60 * 60;
/** The shared finish distance + slack for the final integrator frame. Keeping
 *  this derived prevents a longer client journey from being rejected here. */
export const MAX_DISTANCE_M = FINISH_M + 1_000;
/** Top speed is 260 km/h ≈ 72 m/s; 80 m/s allows integrator slack. */
export const MAX_SPEED_M_PER_S = 80;
/**
 * Drift income per second, as a ceiling. Derived, not guessed:
 *
 *   scoring.ts pays `angleArea × 900 × modeMul × flowMul` on a landed slide,
 *   where angleArea accrues at (|slip| × speedFraction) per second.
 *
 *   A rider cannot hold |slip| at 1.0 — that IS the spin threshold — but call it
 *   0.85 sustained. Take DEGEN (modeMul 1.5) and a maxed FREN FLOW chain
 *   (flowMul 2.0), and hold the slide for the entire run:
 *
 *       0.85 × 900 × 1.5 × 2.0  ≈  2,300 points/second
 *
 * That is nearly three times the ENTIRE pre-drift allowance below, so it has to
 * be accounted for explicitly. It deliberately is NOT charged per claimed drift:
 * `drifts` is attacker-controlled, so a per-drift allowance would let a forged
 * claim buy itself an arbitrarily high ceiling. Time is the one budget a cheat
 * cannot inflate — you can only be sideways for as long as the run lasted.
 */
export const MAX_DRIFT_POINTS_PER_S = 2_400;
/**
 * A scoring slide has to be held for MIN_SCORING_DRIFT_S (0.35s) and re-entered
 * before the next, so two a second is already generous. This only keeps the
 * published `drifts` tag honest — the score ceiling above is time-bounded and
 * does not trust this number.
 */
export const MAX_DRIFTS_PER_S = 2;

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
  /**
   * Powerslides landed. OPTIONAL: a client built before the powerslide shipped
   * (or a stale cached PWA) submits a claim without it, and those runs must keep
   * publishing rather than 422 on a field they have never heard of. Absent is
   * read as zero.
   */
  drifts?: number;
  level: number;
  ended_by: 'time' | 'finish';
  /**
   * Which tour the run rode. OPTIONAL (older clients omit it → 'grand'). The
   * secret 'stone' tour publishes with a `tour` tag and scores into its own
   * addressable namespace (scoreLevelKey), so it never replaces a road score.
   */
  tour?: 'grand' | 'world' | 'stone';
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
  if (value.tour !== undefined && value.tour !== 'grand' && value.tour !== 'world' && value.tour !== 'stone') {
    return { ok: false, status: 422, error: 'invalid_payload', detail: 'tour must be grand|world|stone' };
  }
  const claim = value as ClaimInput;

  if (claim.score <= 0) return { ok: false, status: 422, error: 'invalid_score' };
  if (claim.level < 1 || claim.level > 10) return { ok: false, status: 422, error: 'invalid_level' };
  // The secret prehistoric trip is a single leg — there is no stone level 2.
  if (claim.tour === 'stone' && claim.level !== 1) return { ok: false, status: 422, error: 'invalid_level' };
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
  // and distance cannot meaningfully exceed the shared finish line.
  if (claim.distance_m > MAX_DISTANCE_M) return { ok: false, status: 422, error: 'implausible_distance' };
  if (claim.distance_m > claim.duration_s * MAX_SPEED_M_PER_S) {
    return { ok: false, status: 422, error: 'implausible_distance' };
  }
  if (claim.top_speed_kph > 400) return { ok: false, status: 422, error: 'implausible_speed' };
  if (claim.drifts !== undefined) {
    if (!Number.isInteger(claim.drifts) || claim.drifts < 0) {
      return { ok: false, status: 422, error: 'invalid_payload', detail: 'drifts must be a non-negative integer' };
    }
    if (claim.drifts > claim.duration_s * MAX_DRIFTS_PER_S) {
      return { ok: false, status: 422, error: 'implausible_drifts' };
    }
  }

  // Score ceiling: distance points dominate (~1/m, 1.5× on degen); pickups,
  // overtakes, streak multipliers and the finish time-bonus ride on top. This
  // is deliberately loose — it only has to make nonsense claims impossible,
  // not price every run exactly.
  //
  // The drift term is NOT decoration. Powerslides pay by the second and can
  // out-earn everything else on this line put together (see
  // MAX_DRIFT_POINTS_PER_S), so without it a genuinely good drift-heavy DEGEN
  // run would be refused as an impossible score — the worst possible failure for
  // an anti-cheat rule, because it only ever fires on the players who earned it.
  const plausibleScore = 10_000
    + claim.distance_m * 4
    + claim.duration_s * (800 + MAX_DRIFT_POINTS_PER_S);
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
