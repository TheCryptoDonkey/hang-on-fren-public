import { describe, it, expect } from 'vitest';
import { parseClaim, cleanPlayerName, type ClaimInput } from './claim-rules.js';

const NOW = 1_800_000_000_000;

function validClaim(overrides: Partial<ClaimInput> = {}): ClaimInput {
  return {
    game: 'hangonfren',
    score: 12_000,
    distance_m: 8_000,
    duration_s: 180,
    started_at: NOW - 200_000,
    finished_at: NOW - 10_000,
    run_id: 'run-abc-123',
    roses: 4,
    overtakes: 12,
    crashes: 2,
    top_speed_kph: 260,
    level: 4,
    ended_by: 'time',
    player_name: 'DNI',
    player_mode: 'guest',
    ...overrides,
  };
}

describe('claim-rules', () => {
  it('accepts a plausible run', () => {
    const result = parseClaim(validClaim(), NOW);
    expect(result.ok).toBe(true);
  });

  it('rejects the wrong game and malformed run ids', () => {
    expect(parseClaim(validClaim({ game: 'pallasite' as ClaimInput['game'] }), NOW)).toMatchObject({ ok: false, error: 'wrong_game' });
    expect(parseClaim(validClaim({ run_id: 'x' }), NOW)).toMatchObject({ ok: false, error: 'invalid_run_id' });
  });

  it('rejects non-integer and negative stats', () => {
    expect(parseClaim(validClaim({ score: 12.5 }), NOW).ok).toBe(false);
    expect(parseClaim(validClaim({ roses: -1 }), NOW).ok).toBe(false);
  });

  it('rejects stale, future and inverted run clocks', () => {
    expect(parseClaim(validClaim({ started_at: NOW - 14 * 60 * 1000, finished_at: NOW - 11 * 60 * 1000 }), NOW)).toMatchObject({ ok: false, error: 'stale_run' });
    expect(parseClaim(validClaim({ finished_at: NOW + 2 * 60 * 1000 }), NOW)).toMatchObject({ ok: false, error: 'invalid_run_clock' });
    expect(parseClaim(validClaim({ started_at: NOW, finished_at: NOW - 1 }), NOW)).toMatchObject({ ok: false, error: 'invalid_run_clock' });
  });

  it('rejects run time exceeding the wall clock (pauses only stretch the wall side)', () => {
    const result = parseClaim(validClaim({ started_at: NOW - 60_000, finished_at: NOW - 10_000, duration_s: 120 }), NOW);
    expect(result).toMatchObject({ ok: false, error: 'duration_clock_mismatch' });
  });

  it('rejects physically impossible distance', () => {
    // 8 km in 60 s is 133 m/s — nearly double the bike's top speed.
    expect(parseClaim(validClaim({ duration_s: 60, started_at: NOW - 70_000 }), NOW)).toMatchObject({ ok: false, error: 'implausible_distance' });
    expect(parseClaim(validClaim({ distance_m: 25_000, duration_s: 600, started_at: NOW - 700_000 }), NOW)).toMatchObject({ ok: false, error: 'implausible_distance' });
  });

  it('rejects an implausible score for the ground covered', () => {
    expect(parseClaim(validClaim({ score: 999_999 }), NOW)).toMatchObject({ ok: false, error: 'implausible_score' });
  });

  it('rejects out-of-range levels', () => {
    expect(parseClaim(validClaim({ level: 0 }), NOW)).toMatchObject({ ok: false, error: 'invalid_level' });
    expect(parseClaim(validClaim({ level: 11 }), NOW)).toMatchObject({ ok: false, error: 'invalid_level' });
  });

  it('cleans player names', () => {
    expect(cleanPlayerName('  DNI   RIDER  ')).toBe('DNI RIDER');
    expect(cleanPlayerName('')).toBeNull();
    expect(cleanPlayerName(42)).toBeNull();
    expect(cleanPlayerName('x'.repeat(50))).toHaveLength(32);
  });
});
