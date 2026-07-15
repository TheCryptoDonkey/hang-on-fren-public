import { describe, it, expect, afterEach } from 'vitest';
import {
  stageAt, stageIndexAt, rosterAt, sceneryKitAt, paletteAt, timeOfDayAt, marketPhaseAt,
  setActiveTour, getActiveTour, levelCount, finishDistanceM, roseRichAt,
  STAGE_M, TRANSITION, LEVELS, FINISH_M, WORLD_LEVELS, DEFAULT_PALETTE,
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
    expect(STAGE_M).toBe(4200);
    expect(FINISH_M).toBe(42000);
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
    expect(sceneryKitAt(held(4)).trees).toContain('prop-lamp');
    expect(sceneryKitAt(held(4)).trees).toContain('prop-neon');
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

describe('stages: 600B world tour (the conference circuit)', () => {
  afterEach(() => setActiveTour('grand'));

  it('defaults to the grand tour', () => {
    expect(getActiveTour()).toBe('grand');
    expect(levelCount()).toBe(LEVELS);
    expect(finishDistanceM()).toBe(FINISH_M);
  });

  it('runs the four conference cities in order over 16.8 km', () => {
    setActiveTour('world');
    const names = ['OLD MANCHESTER', 'OLD PRAGUE', 'OLD MALLORCA', 'TAJ MAHAL'];
    names.forEach((name, k) => expect(stageAt(held(k)).name).toBe(name));
    expect(levelCount()).toBe(WORLD_LEVELS);
    expect(finishDistanceM()).toBe(WORLD_LEVELS * STAGE_M);
    expect(finishDistanceM()).toBe(16_800);
  });

  it('clamps to the Taj Mahal finale rather than wrapping', () => {
    setActiveTour('world');
    expect(stageIndexAt(held(3))).toBe(3);
    expect(stageIndexAt(held(12))).toBe(3);
    expect(stageAt(finishDistanceM() + 5000).name).toBe('TAJ MAHAL');
  });

  it('gives each city its own landmark, with roses lining the Taj', () => {
    setActiveTour('world');
    expect(sceneryKitAt(held(0)).landmark).toBe('prop-mill');
    expect(sceneryKitAt(held(1)).landmark).toBe('prop-clocktower');
    expect(sceneryKitAt(held(2)).landmark).toBe('prop-windmill');
    expect(sceneryKitAt(held(3)).landmark).toBe('prop-tajmahal');
    expect(sceneryKitAt(held(3)).accent).toBe('prop-flowers');
  });

  it('is rose-rich ONLY on the Taj Mahal leg of the world tour', () => {
    setActiveTour('world');
    expect(roseRichAt(held(0))).toBe(false);
    expect(roseRichAt(held(2))).toBe(false);
    expect(roseRichAt(held(3))).toBe(true);
    expect(roseRichAt(finishDistanceM() + 500)).toBe(true); // clamped finale
    setActiveTour('grand');
    expect(roseRichAt(held(3))).toBe(false);
    expect(roseRichAt(held(9))).toBe(false);
  });

  it('swaps palettes, rosters and backdrops onto the world data', () => {
    setActiveTour('world');
    expect(paletteAt(held(0)).grassLight).not.toBe(DEFAULT_PALETTE.grassLight);
    expect(rosterAt(held(0))).toContain('car-van');
    expect(rosterAt(held(3))).toContain('car-bentley');
    expect(timeOfDayAt(held(0))).toEqual({ a: 'manchester', b: 'prague', t: 0 });
    // The final leg holds its own backdrop, exactly like the grand finale.
    expect(timeOfDayAt(held(3))).toEqual({ a: 'tajmahal', b: 'tajmahal', t: 0 });
    // The palette also holds right up to the world-tour finish line.
    expect(paletteAt(finishDistanceM() - 1).grassLight).toBe(paletteAt(held(3)).grassLight);
  });

  it('rides the conference schedule as the checkpoint subtitle arc', () => {
    setActiveTour('world');
    expect(marketPhaseAt(held(0))).toBe('REGISTRATION DAY');
    expect(marketPhaseAt(held(1))).toBe('KEYNOTE DAY');
    expect(marketPhaseAt(held(2))).toBe('PANEL MARATHON');
    expect(marketPhaseAt(held(3))).toBe('CLOSING GALA');
  });

  it('restores the grand tour untouched after switching back', () => {
    setActiveTour('world');
    setActiveTour('grand');
    expect(stageAt(held(0)).name).toBe('AMALFI COAST');
    expect(paletteAt(held(0)).grassLight).toBe(DEFAULT_PALETTE.grassLight);
    expect(marketPhaseAt(held(9))).toBe('NEW DAWN');
  });
});

describe('stages: 600 BILLION BC (the secret prehistoric level)', () => {
  afterEach(() => setActiveTour('grand'));

  it('is a single 4.2 km leg', () => {
    setActiveTour('stone');
    expect(levelCount()).toBe(1);
    expect(finishDistanceM()).toBe(STAGE_M);
    expect(stageAt(held(0)).name).toBe('THE STONED AGE');
  });

  it('clamps to its one leg rather than wrapping', () => {
    setActiveTour('stone');
    expect(stageIndexAt(held(0))).toBe(0);
    expect(stageIndexAt(held(7))).toBe(0);
    expect(stageAt(finishDistanceM() + 5000).name).toBe('THE STONED AGE');
  });

  it('fields dinosaurs and a mammoth instead of cars', () => {
    setActiveTour('stone');
    const roster = rosterAt(held(0));
    expect(roster).toContain('dino-trex');
    expect(roster).toContain('dino-raptor');
    expect(roster).toContain('mammoth');
  });

  it('dresses the roadside in ferns, bones and a volcano', () => {
    setActiveTour('stone');
    const kit = sceneryKitAt(held(0));
    expect(kit.trees).toContain('prop-fern');
    expect(kit.accent).toBe('prop-bones');
    expect(kit.landmark).toBe('prop-volcano');
  });

  it('holds the jurassic backdrop and palette to the finish line', () => {
    setActiveTour('stone');
    expect(timeOfDayAt(held(0))).toEqual({ a: 'jurassic', b: 'jurassic', t: 0 });
    expect(paletteAt(held(0)).grassLight).not.toBe(DEFAULT_PALETTE.grassLight);
    expect(paletteAt(finishDistanceM() - 1).grassLight).toBe(paletteAt(held(0)).grassLight);
  });

  it('subtitles the whole trip ONE BROKEN TIMELINE', () => {
    setActiveTour('stone');
    expect(marketPhaseAt(held(0))).toBe('ONE BROKEN TIMELINE');
    expect(marketPhaseAt(finishDistanceM() - 1)).toBe('ONE BROKEN TIMELINE');
  });

  it('is never rose-rich (that belongs to the Taj)', () => {
    setActiveTour('stone');
    expect(roseRichAt(held(0))).toBe(false);
  });

  it('restores the grand tour untouched after switching back', () => {
    setActiveTour('stone');
    setActiveTour('grand');
    expect(stageAt(held(0)).name).toBe('AMALFI COAST');
    expect(paletteAt(held(0)).grassLight).toBe(DEFAULT_PALETTE.grassLight);
  });
});
