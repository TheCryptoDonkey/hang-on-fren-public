// Best scores recovered from the browser-local arcade board that existed
// before the game-signed claim service. Keeping these public, non-secret rows
// beside the reconciler makes later relay migrations reproducible.

import { GAME_ID } from '../src/scoring.js';
import type { ClaimInput } from './claim-rules.js';

export interface HistoricScoreRow {
  pubkey: string;
  claim: ClaimInput;
  source: 'local-highscores-v2';
}

const UNKNOWN_RUN_FIELDS = {
  duration_s: 0,
  started_at: 0,
  finished_at: 0,
  overtakes: 0,
  crashes: 0,
  top_speed_kph: 0,
} as const;

export const HISTORIC_SCORE_ROWS: readonly HistoricScoreRow[] = [
  {
    // Synthetic, valid Nostr pubkey reserved for this pre-identity arcade
    // record. Its generated secret was discarded; only the game key can make
    // this row eligible for the trusted leaderboard.
    pubkey: '454d56305218383d808d8b1d4d7ec4c6033e75de26e8afb80c07f63259a01626',
    source: 'local-highscores-v2',
    claim: {
      game: GAME_ID,
      score: 142_143,
      distance_m: 42_000,
      roses: 4,
      level: 10,
      ended_by: 'finish',
      run_id: 'historic-local-edb-142143',
      player_name: 'EDB',
      player_mode: 'guest',
      ...UNKNOWN_RUN_FIELDS,
    },
  },
  {
    // Reuse DAZ's existing leaderboard identity so this supersedes the lower
    // published level-10 result instead of creating a duplicate rider.
    pubkey: 'fdbc53d581b4afd15322d2532196b93625ec5f16015891974c5a4d1cc2c4aac2',
    source: 'local-highscores-v2',
    claim: {
      game: GAME_ID,
      score: 81_175,
      distance_m: 42_000,
      roses: 2,
      level: 10,
      ended_by: 'finish',
      run_id: 'historic-local-daz-81175',
      player_name: 'DAZ',
      player_mode: 'guest',
      btc_block: 957_774,
      btc_usd_cents: 6_378_800,
      ...UNKNOWN_RUN_FIELDS,
    },
  },
] as const;

/** Seed the live publish gate without allowing a historic row to lower a
 * claim-log score. This keeps later claims from replacing a stronger imported
 * addressable event after the service restarts. */
export function seedHistoricBestScores(best: Map<string, number>): void {
  for (const { pubkey, claim } of HISTORIC_SCORE_ROWS) {
    const key = `${pubkey}:${claim.level}`;
    if (claim.score > (best.get(key) ?? 0)) best.set(key, claim.score);
  }
}
