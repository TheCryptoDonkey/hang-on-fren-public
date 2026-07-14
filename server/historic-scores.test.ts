import { describe, expect, it } from 'vitest';
import { HISTORIC_SCORE_ROWS, seedHistoricBestScores } from './historic-scores.js';

describe('historic local scores', () => {
  it('preserves the recovered EDB and DAZ bests as distinct valid identities', () => {
    expect(HISTORIC_SCORE_ROWS.map(row => ({
      name: row.claim.player_name,
      score: row.claim.score,
      distanceM: row.claim.distance_m,
      roses: row.claim.roses,
    }))).toEqual([
      { name: 'EDB', score: 142_143, distanceM: 42_000, roses: 4 },
      { name: 'DAZ', score: 81_175, distanceM: 42_000, roses: 2 },
    ]);
    expect(new Set(HISTORIC_SCORE_ROWS.map(row => row.pubkey)).size).toBe(HISTORIC_SCORE_ROWS.length);
    for (const row of HISTORIC_SCORE_ROWS) {
      expect(row.pubkey).toMatch(/^[0-9a-f]{64}$/);
      expect(row.claim.level).toBe(10);
      expect(row.claim.ended_by).toBe('finish');
    }
  });

  it('seeds the live publish gate without lowering a stronger score', () => {
    const dazKey = `${HISTORIC_SCORE_ROWS[1].pubkey}:10`;
    const best = new Map<string, number>([[dazKey, 200_000]]);

    seedHistoricBestScores(best);

    expect(best.get(dazKey)).toBe(200_000);
    expect(best.get(`${HISTORIC_SCORE_ROWS[0].pubkey}:10`)).toBe(142_143);
  });
});
