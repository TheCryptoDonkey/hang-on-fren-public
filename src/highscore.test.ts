import { describe, it, expect } from 'vitest';
import { insertScore, qualifies, rankOf, DEFAULT_BOARD, topScore } from './highscore.js';

describe('highscore', () => {
  it('inserts in descending order and trims to five', () => {
    const board = insertScore(DEFAULT_BOARD, { name: 'NEW', score: 9000, distanceM: 1, roses: 1 });
    expect(board.length).toBe(5);
    expect(board[0].score).toBeGreaterThanOrEqual(board[1].score);
    expect(board.some(e => e.name === 'NEW')).toBe(true);
    expect(board.some(e => e.name === 'AMF')).toBe(false); // lowest dropped
  });

  it('qualifies only for scores that beat the last place', () => {
    expect(qualifies(DEFAULT_BOARD, 1600)).toBe(true);
    expect(qualifies(DEFAULT_BOARD, 1400)).toBe(false);
    expect(qualifies([], 1)).toBe(true);
  });

  it('ranks a score 0-based against the board', () => {
    expect(rankOf(DEFAULT_BOARD, 999999)).toBe(0);
    expect(rankOf(DEFAULT_BOARD, 0)).toBe(5);
    expect(topScore(DEFAULT_BOARD)).toBe(12000);
  });
});
