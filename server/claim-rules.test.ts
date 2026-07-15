import { describe, it, expect } from 'vitest';
import { parseClaim, cleanPlayerName, MAX_DRIFT_POINTS_PER_S, MAX_DRIFTS_PER_S, type ClaimInput } from './claim-rules.js';

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

  it('accepts the known tours (and their absence), rejects invented ones', () => {
    expect(parseClaim(validClaim(), NOW).ok).toBe(true); // older clients omit tour
    expect(parseClaim(validClaim({ tour: 'grand' }), NOW).ok).toBe(true);
    expect(parseClaim(validClaim({ tour: 'world' }), NOW).ok).toBe(true);
    expect(parseClaim(validClaim({ tour: 'stone', level: 1, distance_m: 4000, score: 9000 }), NOW).ok).toBe(true);
    expect(parseClaim(validClaim({ tour: 'moon' as ClaimInput['tour'] }), NOW)).toMatchObject({ ok: false, error: 'invalid_payload' });
  });

  it('accepts stone claims across its five legs, refuses beyond', () => {
    // The secret trip runs five legs (21 km) — a finish claims at level 5.
    expect(parseClaim(validClaim({ tour: 'stone', level: 2, distance_m: 5000, score: 12000, duration_s: 90, started_at: NOW - 100_000 }), NOW).ok).toBe(true);
    expect(parseClaim(validClaim({ tour: 'stone', level: 5, distance_m: 21_000, score: 40_000, duration_s: 400, started_at: NOW - 410_000 }), NOW).ok).toBe(true);
    expect(parseClaim(validClaim({ tour: 'stone', level: 6 }), NOW)).toMatchObject({ ok: false, error: 'invalid_level' });
    expect(parseClaim(validClaim({ tour: 'stone', level: 0 }), NOW)).toMatchObject({ ok: false, error: 'invalid_level' });
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
    expect(parseClaim(validClaim({ distance_m: 44_000, duration_s: 600, started_at: NOW - 700_000 }), NOW)).toMatchObject({ ok: false, error: 'implausible_distance' });
  });

  it('accepts a plausible finish of the shared 42 km grand tour', () => {
    const result = parseClaim(validClaim({
      distance_m: 42_000,
      duration_s: 600,
      started_at: NOW - 610_000,
      level: 10,
      ended_by: 'finish',
    }), NOW);
    expect(result.ok).toBe(true);
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

  it('keeps sane bitcoin chain flavour on the claim', () => {
    const result = parseClaim(validClaim({ btc_block: 905_432, btc_usd_cents: 10_425_000 }), NOW);
    expect(result).toMatchObject({ ok: true, claim: { btc_block: 905_432, btc_usd_cents: 10_425_000 } });
  });

  it('drops implausible bitcoin flavour without refusing the score', () => {
    const cases: Array<Partial<ClaimInput>> = [
      { btc_block: -1 },
      { btc_block: 3.14 },
      { btc_block: 200_000_000 },
      { btc_block: '905432' as unknown as number },
      { btc_usd_cents: 0 },
      { btc_usd_cents: 100_000_000_000 },
    ];
    for (const overrides of cases) {
      const result = parseClaim(validClaim(overrides), NOW);
      expect(result.ok).toBe(true);
      if (result.ok) {
        const key = Object.keys(overrides)[0] as keyof ClaimInput;
        expect(result.claim[key]).toBeUndefined();
      }
    }
  });
});

describe('claim-rules: powerslides', () => {
  it('accepts a claim that carries drifts', () => {
    const result = parseClaim(validClaim({ drifts: 40 }), NOW);
    expect(result.ok).toBe(true);
  });

  it('still accepts a claim with NO drifts field at all', () => {
    // A client built before the powerslide shipped — or a stale cached PWA —
    // submits a claim that has never heard of `drifts`. Those runs must keep
    // publishing. Making the field required would 422 every player who had not
    // yet picked up the new build, which is a silent outage, not a validation.
    const { drifts: _omitted, ...withoutDrifts } = validClaim({ drifts: 7 });
    const result = parseClaim(withoutDrifts, NOW);
    expect(result.ok).toBe(true);
  });

  it('refuses a nonsense drift count', () => {
    const tooMany = validClaim({ drifts: 180 * MAX_DRIFTS_PER_S + 1, duration_s: 180 });
    expect(parseClaim(tooMany, NOW)).toMatchObject({ ok: false, error: 'implausible_drifts' });
    expect(parseClaim(validClaim({ drifts: -1 }), NOW)).toMatchObject({ ok: false, error: 'invalid_payload' });
    expect(parseClaim(validClaim({ drifts: 2.5 }), NOW)).toMatchObject({ ok: false, error: 'invalid_payload' });
  });

  it('does not refuse a drift-heavy run as an impossible score', () => {
    // THE case this ceiling exists for. Powerslides pay by the second and can
    // out-earn every other source combined; before the drift term was added to
    // the ceiling, a genuinely good sideways DEGEN run scored high enough to be
    // thrown out as a forgery. An anti-cheat rule that only ever fires on the
    // players who earned it is worse than no rule.
    const duration = 200;
    const driftHeavy = validClaim({
      duration_s: duration,
      started_at: NOW - duration * 1000 - 20_000,
      distance_m: 8_000,
      drifts: 60,
      score: 10_000 + 8_000 * 4 + duration * (800 + MAX_DRIFT_POINTS_PER_S) - 1,
    });
    expect(parseClaim(driftHeavy, NOW)).toMatchObject({ ok: true });
  });

  it('but the ceiling is still a ceiling', () => {
    const duration = 200;
    const absurd = validClaim({
      duration_s: duration,
      started_at: NOW - duration * 1000 - 20_000,
      distance_m: 8_000,
      drifts: 60,
      score: 10_000 + 8_000 * 4 + duration * (800 + MAX_DRIFT_POINTS_PER_S) + 1,
    });
    expect(parseClaim(absurd, NOW)).toMatchObject({ ok: false, error: 'implausible_score' });
  });

  it('a forged drift count cannot buy a higher score ceiling', () => {
    // The ceiling is TIME-bounded, never per-drift: `drifts` is attacker-supplied,
    // so charging an allowance per claimed drift would let a forged claim mint
    // itself unlimited headroom. You can only be sideways for as long as the run.
    const duration = 60;
    const overCeiling = 10_000 + 1_000 * 4 + duration * (800 + MAX_DRIFT_POINTS_PER_S) + 5_000;
    const modest = validClaim({ duration_s: duration, distance_m: 1_000, drifts: 1, score: overCeiling });
    const stuffed = validClaim({ duration_s: duration, distance_m: 1_000, drifts: 100, score: overCeiling });
    expect(parseClaim(modest, NOW)).toMatchObject({ ok: false, error: 'implausible_score' });
    // Claiming 100× the drifts buys exactly nothing: same score, same refusal.
    expect(parseClaim(stuffed, NOW)).toMatchObject({ ok: false, error: 'implausible_score' });
  });
});
