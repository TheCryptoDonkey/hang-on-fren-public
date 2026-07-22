// Pure claim validation for the hang-on-fren score-claim service. The server
// signs the leaderboard event with the GAME key (like neon-sentinel/pallasite),
// so these plausibility checks are what stops a hand-rolled HTTP request from
// planting an impossible score on the board. Kept pure and node-free so it can
// be unit-tested with the rest of the suite.

import { GAME_ID, POINTS_PER_DRIFT_SECOND } from '../src/scoring.js';
import { FINISH_M, STONE_LEVELS } from '../src/stages.js';
import { BEER_SPEED_MUL, BOOST_SPEED_MUL, PLAYER_BASE_TOP_SPEED, SLING_SPEED_MUL, UNITS_PER_M } from '../src/road.js';
import { MODES } from '../src/difficulty.js';
import { MAX_FLOW_MULTIPLIER } from '../src/flow.js';

/** Milliseconds a finished run may lag before a claim is refused. Generous —
 *  a board run only submits after the callsign is typed. */
export const STALE_RUN_MS = 10 * 60 * 1000;
export const FUTURE_SLACK_MS = 60 * 1000;
/** The clock economy makes multi-hour runs impossible; an hour is generous. */
export const MAX_DURATION_S = 60 * 60;
/** The shared finish distance + slack for the final integrator frame. Keeping
 *  this derived prevents a longer client journey from being rejected here. */
export const MAX_DISTANCE_M = FINISH_M + 1_000;
/**
 * The bike's true ceiling in m/s: base top speed with every speed pickup live
 * at once (rose boost × slingshot × beer stack multiplicatively on maxSpeed),
 * plus 5% slack for the rounded duration (±0.5 s) and the integrator step.
 * Derived, not guessed — the previous hand-written 80 sat BELOW the bike's
 * base cruise of ~88.9 m/s (the HUD's "260 km/h" is a cosmetic scale), so the
 * fastest honest runs were exactly the ones refused as impossible: the worst
 * failure an anti-cheat rule can have, and for three days in July 2026 the
 * reason the gamestr board looked abandoned while players were being 422'd.
 */
export const MAX_SPEED_M_PER_S = (PLAYER_BASE_TOP_SPEED / UNITS_PER_M)
  * BOOST_SPEED_MUL * SLING_SPEED_MUL * BEER_SPEED_MUL * 1.05;
/** The braver-roads score multiplier at its bravest (DEGEN). */
const MAX_MODE_SCORE_MUL = Math.max(...MODES.map(mode => mode.scoreMul));
/**
 * Drift income per second, as a ceiling. Derived, not guessed:
 *
 *   scoring.ts pays `angleArea × POINTS_PER_DRIFT_SECOND × modeMul × flowMul`
 *   on a landed slide, where angleArea accrues at (|slip| × speedFraction) per
 *   second, so 1.0/s is its hard ceiling. And |slip| ≈ 1.0 IS honestly
 *   sustainable: the sacred stone's STONE GRIP suspends drift creep entirely,
 *   letting a monster corner be ridden at full lock end to end (an earlier
 *   0.85 "nobody can hold full slip" discount here refused exactly the runs
 *   that deserved the board).
 *
 * It deliberately is NOT charged per claimed drift: `drifts` is
 * attacker-controlled, so a per-drift allowance would let a forged claim buy
 * itself an arbitrarily high ceiling. Time is the one budget a cheat cannot
 * inflate — you can only be sideways for as long as the run lasted.
 */
export const MAX_DRIFT_POINTS_PER_S = Math.ceil(
  POINTS_PER_DRIFT_SECOND * MAX_MODE_SCORE_MUL * MAX_FLOW_MULTIPLIER,
);
/**
 * Everything else the clock can pay per second — pickups, overtakes, near
 * misses — at DEGEN with a LEGEND flow chain and a hot streak. A dense second
 * can genuinely bank ~2,000 (overtake 250 + can 120×streak + near-miss ≤ 120,
 * all × 1.5 × 2.0); sustaining that for a whole run is beyond any honest
 * rider, which is what makes it a ceiling.
 */
export const MAX_ACTION_POINTS_PER_S = 2_000;
/**
 * One-off income that rides outside the per-second flow: the finish-line time
 * bonus (≤ 60 s banked × 100, unmultiplied) plus a rival win (3,000 × mode ×
 * flow ≤ 9,000), with headroom. The old 10,000 could be exceeded by those two
 * alone.
 */
export const SCORE_CEILING_FLAT = 20_000;
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
  // The secret prehistoric trip runs STONE_LEVELS legs (derived, like
  // MAX_DISTANCE_M, so lengthening the trip client-side can't strand the
  // server refusing honest claims).
  if (claim.tour === 'stone' && (claim.level < 1 || claim.level > STONE_LEVELS)) {
    return { ok: false, status: 422, error: 'invalid_level' };
  }
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

  // Score ceiling: distance points (1/m × mode mult, ×4 for margin), the
  // per-second action and drift envelopes, and a flat term for one-off
  // bonuses. This is deliberately loose — it only has to make nonsense claims
  // impossible, not price every run exactly.
  //
  // The drift term is NOT decoration. Powerslides pay by the second and can
  // out-earn everything else on this line put together (see
  // MAX_DRIFT_POINTS_PER_S), so without it a genuinely good drift-heavy DEGEN
  // run would be refused as an impossible score — the worst possible failure for
  // an anti-cheat rule, because it only ever fires on the players who earned it.
  const plausibleScore = SCORE_CEILING_FLAT
    + claim.distance_m * 4
    + claim.duration_s * (MAX_ACTION_POINTS_PER_S + MAX_DRIFT_POINTS_PER_S);
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
