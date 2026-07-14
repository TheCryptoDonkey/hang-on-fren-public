import { describe, expect, it } from 'vitest';
import { HISTORIC_SCORE_ROWS } from './historic-scores.js';

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
});
