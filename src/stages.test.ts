import { describe, it, expect } from 'vitest';
import {
  stageAt, stageIndexAt, rosterAt, sceneryKitAt, paletteAt, timeOfDayAt, marketPhaseAt,
  STAGE_M, TRANSITION, LEVELS, FINISH_M, DEFAULT_PALETTE,
} from './stages.js';

// A distance a small way into leg `k` (well before the transition zone).
const held = (k: number): number => k * STAGE_M + STAGE_M * 0.1;

describe('stages: ten finite levels', () => {
  it('runs the ten regions in journey order', () => {
    const names = [
      'AMALFI COAST', 'TROPICO BAY', 'ALPINE PASS', 'DESERT MESA', 'NEON CITY',
      'CHERRY VALLEY', 'AUTUMN FOREST', 'SALT LAKE', 'VOLCANO ROAD', 'GOLDEN COAST',
    ];
    names.forEach((name, k) => expect(stageAt(held(k)).name).toBe(name));
    expect(LEVELS).toBe(10);
  });

  it('does NOT wrap — the finale holds past the last checkpoint', () => {
    // Beyond the tenth leg the index is clamped to the finale (no 11th region).
    expect(stageIndexAt(held(9))).toBe(9);
    expect(stageIndexAt(held(12))).toBe(9);
    expect(stageAt(FINISH_M + 5000).name).toBe('GOLDEN COAST');
  });

  it('puts the finish line at ten legs of road', () => {
    expect(FINISH_M).toBe(LEVELS * STAGE_M);
    expect(FINISH_M).toBe(20000);
  });

  it('gives sampled regions their own car roster', () => {
    expect(rosterAt(held(0))).toContain('car-classic');
    expect(rosterAt(held(3))).toContain('car-banger'); // desert beaters
    expect(rosterAt(held(4))).toContain('car-ferrari'); // city supercars
    expect(rosterAt(held(9))).toContain('car-lambo'); // grand finale
  });

  it('swaps the scenery kit per region', () => {
    expect(sceneryKitAt(held(1)).landmark).toBe('prop-beachhut');
    expect(sceneryKitAt(held(3)).trees).toContain('prop-cactus');
    expect(sceneryKitAt(held(4)).landmark).toBe('prop-skyscraper');
    expect(sceneryKitAt(held(5)).trees).toContain('prop-blossom');
    expect(sceneryKitAt(held(8)).landmark).toBe('prop-lavarock');
    // Finale reuses the Amalfi kit for the run home.
    expect(sceneryKitAt(held(9)).landmark).toBe('prop-villa');
  });

  it('stageIndexAt clamps negatives, floors by STAGE_M, caps at the finale', () => {
    expect(stageIndexAt(-500)).toBe(0);
    expect(stageIndexAt(0)).toBe(0);
    expect(stageIndexAt(STAGE_M - 1)).toBe(0);
    expect(stageIndexAt(STAGE_M)).toBe(1);
    expect(stageIndexAt(STAGE_M * 50)).toBe(LEVELS - 1);
  });
});

describe('stages: hold-then-transition blend', () => {
  it('holds a region for the bulk of its leg (verge colour unchanged mid-leg)', () => {
    expect(paletteAt(held(0)).grassLight).toBe(DEFAULT_PALETTE.grassLight);
    expect(paletteAt(STAGE_M * 0.5).grassLight).toBe(DEFAULT_PALETTE.grassLight);
    expect(paletteAt(STAGE_M * (1 - TRANSITION) - 1).grassLight).toBe(DEFAULT_PALETTE.grassLight);
  });

  it('has fully arrived in the next region by the checkpoint', () => {
    const bayStart = paletteAt(STAGE_M);
    const bayHeld = paletteAt(held(1));
    expect(bayStart.grassLight).toBe(bayHeld.grassLight);
    expect(bayStart.grassLight).not.toBe(DEFAULT_PALETTE.grassLight);
  });

  it('morphs somewhere inside the transition zone', () => {
    const mid = paletteAt(STAGE_M * (1 - TRANSITION / 2));
    expect(mid.grassLight).not.toBe(DEFAULT_PALETTE.grassLight);
    expect(mid.grassLight).not.toBe(paletteAt(held(1)).grassLight);
  });

  it('holds the final leg — no morph back toward Amalfi before the finish', () => {
    const finaleHeld = paletteAt(held(9)).grassLight;
    // Right up to the finish line the finale palette is unchanged (f stays 0).
    expect(paletteAt(FINISH_M - 1).grassLight).toBe(finaleHeld);
    expect(paletteAt(FINISH_M - 1).grassLight).not.toBe(DEFAULT_PALETTE.grassLight);
  });
});

describe('stages: crypto-market phase subtitle arc', () => {
  it('climbs BEAR → BULL → MOON → NEW DAWN across the ten levels, ending on NEW DAWN', () => {
    expect(marketPhaseAt(held(0))).toBe('BEAR MARKET');
    expect(marketPhaseAt(held(2))).toBe('BEAR MARKET');
    expect(marketPhaseAt(held(3))).toBe('BULL RUN');
    expect(marketPhaseAt(held(4))).toBe('BULL RUN');
    expect(marketPhaseAt(held(5))).toBe('TO THE MOON');
    expect(marketPhaseAt(held(7))).toBe('TO THE MOON');
    expect(marketPhaseAt(held(8))).toBe('NEW DAWN');
    expect(marketPhaseAt(held(9))).toBe('NEW DAWN'); // the finale
  });
});

describe('stages: horizon backdrop selection', () => {
  it('picks the current + next biome panorama with a matching blend', () => {
    expect(timeOfDayAt(held(0))).toEqual({ a: 'riviera', b: 'beach', t: 0 });
    expect(timeOfDayAt(held(3))).toEqual({ a: 'desert', b: 'city', t: 0 });
    // The final leg holds its own backdrop (no crossfade toward another region).
    expect(timeOfDayAt(held(9))).toEqual({ a: 'finale', b: 'finale', t: 0 });
    // Inside a mid-journey transition zone the crossfade is under way.
    expect(timeOfDayAt(STAGE_M * (1 - TRANSITION / 2)).t).toBeGreaterThan(0);
  });
});
