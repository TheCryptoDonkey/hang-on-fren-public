// OutRun-style regions: the drive is now a FINITE ten-level journey. As distance
// climbs it rolls through ten visually distinct BIOMES — from the Amalfi coast
// out across the world and back to a triumphant golden coast — and then hits a
// FINISH LINE (see FINISH_M) that completes the game, rather than looping.
//
// The biome PALETTE (verge/sea/hills colours) morphs smoothly into the next
// across the run-up to each checkpoint, while the scenery KIT, region NAME and
// car ROSTER hard-swap at the checkpoint boundary. The final leg holds its biome
// all the way to the finish (there is nothing after it to morph into).
//
// Pure + data-only so it stays trivially testable and has no render/DOM deps.

import { clamp, easeInOut } from './util.js';

export interface Palette {
  skyTop: string;
  skyHorizon: string;
  sea: string;
  hillsFar: string;
  hillsNear: string;
  /** The roadside verge slab (grass / sand / snow / dust… per biome). */
  grassLight: string;
  grassDark: string;
  roadLight: string;
  roadDark: string;
  rumbleLight: string;
  rumbleDark: string;
  lane: string;
  offRoadLight: string;
  offRoadDark: string;
  fog: string;
  /** Sun/moon disc colour. */
  sun: string;
  /** 0..1 — how much of a starfield to sprinkle in the sky. */
  star: number;
}

export interface Stage {
  index: number;
  name: string;
  /** Cars that spawn during this stage (sprite ids). */
  roster: readonly string[];
}

/** How many levels/regions the journey is made of. */
export const LEVELS = 10;
/** Metres of road per stage / between checkpoints. 4.2 km turns the ten-region
 *  trip into a proper 42 km grand tour (and keeps the game's 4.20 / 42 lore),
 *  long enough for each biome and its road features to establish a rhythm. */
export const STAGE_M = 4200;
/** Distance at which the finish line sits — completing the tenth level wins. */
export const FINISH_M = LEVELS * STAGE_M;
/** Seconds granted when the rider crosses into a new stage (OutRun checkpoint).
 *  The longer 4.2 km legs earn a full petrol-can-sized top-up. */
export const CHECKPOINT_BONUS = 21;
/** Fraction of a leg (measured from its end) over which the biome morphs into
 *  the next one. The biome is held for the rest of the leg so each region reads
 *  as its own distinct place, with the change happening on the run into the
 *  checkpoint. Shared by the palette blend and the horizon crossfade. */
export const TRANSITION = 0.22;

// --- biome palettes (one per level, in journey order) -----------------------

// 1. AMALFI COAST — bright Riviera: green verges, blue bay, tan gravel off-road.
const RIVIERA: Palette = {
  skyTop: '#2aa8e0', skyHorizon: '#bfeaf6', sea: '#1f6fae',
  hillsFar: '#7fa9c8', hillsNear: '#5c8f6a',
  grassLight: '#7cc36a', grassDark: '#71b860',
  roadLight: '#8b909a', roadDark: '#83888f',
  rumbleLight: '#f4f4f4', rumbleDark: '#d24b4b', lane: '#f5f2e8',
  offRoadLight: '#c9a86a', offRoadDark: '#bf9e60', fog: '#cfeaf0',
  sun: '#fff6d6', star: 0,
};

// 2. TROPICO BAY — tropical seaside: golden sand verges, turquoise lagoon.
const BEACH: Palette = {
  skyTop: '#3fc0e8', skyHorizon: '#dcf7f2', sea: '#12b3c4',
  hillsFar: '#8fd8d0', hillsNear: '#e0c98a',
  grassLight: '#efd9a3', grassDark: '#e6cd90',
  roadLight: '#9a9a94', roadDark: '#90908a',
  rumbleLight: '#fff6e0', rumbleDark: '#ff7a4d', lane: '#fff3d8',
  offRoadLight: '#e8cf94', offRoadDark: '#dcc078', fog: '#e0f7f0',
  sun: '#fff2c0', star: 0,
};

// 3. ALPINE PASS — cold mountain road: snow verges, misty grey-blue peaks.
const ALPINE: Palette = {
  skyTop: '#5f93c8', skyHorizon: '#d6e6f2', sea: '#5f86a8',
  hillsFar: '#9fb2c8', hillsNear: '#8fa8bf',
  grassLight: '#eef4fb', grassDark: '#dce6f0',
  roadLight: '#8f96a0', roadDark: '#868d97',
  rumbleLight: '#ffffff', rumbleDark: '#8fa3b8', lane: '#eef4fb',
  offRoadLight: '#e2ecf5', offRoadDark: '#cdd8e4', fog: '#e6eef6',
  sun: '#fdfbff', star: 0.05,
};

// 4. DESERT MESA — hot red-rock canyon: dusty sand verges, terracotta rumble.
const DESERT: Palette = {
  skyTop: '#57b4dd', skyHorizon: '#f0d9a0', sea: '#c98f5a',
  hillsFar: '#c98f5a', hillsNear: '#b0713e',
  grassLight: '#e6b878', grassDark: '#dcac6c',
  roadLight: '#9a938a', roadDark: '#918a82',
  rumbleLight: '#fff0d0', rumbleDark: '#c2502a', lane: '#fff0d0',
  offRoadLight: '#d8a860', offRoadDark: '#cc9a52', fog: '#f0dcb0',
  sun: '#fff2c8', star: 0,
};

// 5. NEON CITY — synthwave night city: dark asphalt verges, neon rumble.
const CITY: Palette = {
  skyTop: '#0b1030', skyHorizon: '#3a2a5a', sea: '#141a3a',
  hillsFar: '#2a2050', hillsNear: '#3a2a5a',
  grassLight: '#2f3550', grassDark: '#272c44',
  roadLight: '#3a3f4a', roadDark: '#33383f',
  rumbleLight: '#ffd76b', rumbleDark: '#ff4d6d', lane: '#ffe9a8',
  offRoadLight: '#2a2f40', offRoadDark: '#232838', fog: '#2a2440',
  sun: '#dfe6ff', star: 0.85,
};

// 6. CHERRY VALLEY — fresh green valley strewn with pink blossom, pink rumble.
const VALLEY: Palette = {
  skyTop: '#7ac8ea', skyHorizon: '#e6f2ee', sea: '#5fa9c8',
  hillsFar: '#9fd0e0', hillsNear: '#7bbf7a',
  grassLight: '#8fd07a', grassDark: '#83c66e',
  roadLight: '#8b909a', roadDark: '#83888f',
  rumbleLight: '#ffffff', rumbleDark: '#e86a9a', lane: '#fef0f5',
  offRoadLight: '#8fc47a', offRoadDark: '#83b96e', fog: '#e8f2ee',
  sun: '#fff6d6', star: 0,
};

// 7. AUTUMN FOREST — rust-and-gold woods: golden-leaf verges, amber haze.
const AUTUMN: Palette = {
  skyTop: '#6fb3d8', skyHorizon: '#f0e2c0', sea: '#5a86a0',
  hillsFar: '#c99a5a', hillsNear: '#b5702f',
  grassLight: '#d9a24e', grassDark: '#cf9644',
  roadLight: '#8f8a82', roadDark: '#87827a',
  rumbleLight: '#fff0d0', rumbleDark: '#c2502a', lane: '#ffeccd',
  offRoadLight: '#cf9040', offRoadDark: '#c38638', fog: '#f0e0c0',
  sun: '#ffe6b0', star: 0,
};

// 8. SALT LAKE — serene pink-salt mirror flats: pale lilac verges, salt rumble.
const SALT: Palette = {
  skyTop: '#8fbfe0', skyHorizon: '#eaf2f6', sea: '#bfe0e6',
  hillsFar: '#c8d4dc', hillsNear: '#b0c0c8',
  grassLight: '#e6dfe8', grassDark: '#dcd4de',
  roadLight: '#9a9aa2', roadDark: '#92929a',
  rumbleLight: '#ffffff', rumbleDark: '#c98fb0', lane: '#f4eef6',
  offRoadLight: '#ded6e0', offRoadDark: '#d2cad4', fog: '#eef2f4',
  sun: '#fff2e0', star: 0,
};

// 9. VOLCANO ROAD — ash sky and black lava: charred verges, ember rumble.
const VOLCANO: Palette = {
  skyTop: '#3a1420', skyHorizon: '#8a3a2a', sea: '#c8401a',
  hillsFar: '#5a2a30', hillsNear: '#3a1c1e',
  grassLight: '#4a2e2e', grassDark: '#3e2626',
  roadLight: '#2e2a2c', roadDark: '#282428',
  rumbleLight: '#ffb44d', rumbleDark: '#e5401a', lane: '#ff9d4d',
  offRoadLight: '#3a2626', offRoadDark: '#301e1e', fog: '#5a2a24',
  sun: '#ff7a3c', star: 0.15,
};

// 10. GOLDEN COAST — triumphant golden-hour Riviera finale: lush green, gold rumble.
const FINALE: Palette = {
  skyTop: '#3aa0e0', skyHorizon: '#ffe6b0', sea: '#1f7fbe',
  hillsFar: '#8fb0c8', hillsNear: '#5c9f6a',
  grassLight: '#8fd07a', grassDark: '#83c66e',
  roadLight: '#8b909a', roadDark: '#83888f',
  rumbleLight: '#ffffff', rumbleDark: '#ffb43c', lane: '#fff6e0',
  offRoadLight: '#c9a86a', offRoadDark: '#bf9e60', fog: '#ffe8c0',
  sun: '#fff2d0', star: 0,
};

const KEYFRAMES: readonly Palette[] = [
  RIVIERA, BEACH, ALPINE, DESERT, CITY, VALLEY, AUTUMN, SALT, VOLCANO, FINALE,
];

const STAGES: readonly { name: string; roster: readonly string[] }[] = [
  // 1 Amalfi — old-money Italian traffic pottering along the coast road.
  { name: 'AMALFI COAST', roster: ['car-classic', 'car-van', 'car-banger'] },
  // 2 Tropico Bay — holiday convertibles and a stray scooter.
  { name: 'TROPICO BAY', roster: ['car-porsche', 'car-ferrari', 'scooter-rival'] },
  // 3 Alpine Pass — grand tourers hauling up the mountain.
  { name: 'ALPINE PASS', roster: ['car-bentley', 'car-lambo', 'car-classic'] },
  // 4 Desert Mesa — dusty beaters and vans crossing the canyon.
  { name: 'DESERT MESA', roster: ['car-banger', 'car-van', 'car-classic'] },
  // 5 Neon City — supercars tearing through the night.
  { name: 'NEON CITY', roster: ['car-ferrari', 'car-lambo', 'car-porsche'] },
  // 6 Cherry Valley — gentle country traffic through the blossom.
  { name: 'CHERRY VALLEY', roster: ['scooter-rival', 'car-classic', 'car-van'] },
  // 7 Autumn Forest — stately tourers on the woodland road.
  { name: 'AUTUMN FOREST', roster: ['car-bentley', 'car-banger', 'car-classic'] },
  // 8 Salt Lake — fast machines skating the flats.
  { name: 'SALT LAKE', roster: ['car-porsche', 'car-lambo', 'car-ferrari'] },
  // 9 Volcano Road — dramatic exotics on the lava road.
  { name: 'VOLCANO ROAD', roster: ['car-lambo', 'car-ferrari', 'car-bentley'] },
  // 10 Golden Coast — a grand finale field for the run home.
  { name: 'GOLDEN COAST', roster: ['car-ferrari', 'car-lambo', 'car-bentley'] },
];

/**
 * Per-biome roadside scenery kit (OutRun-style: each region looks different).
 * The baked track tags scenery "slots" (tree / accent / landmark) and the
 * renderer resolves each slot to this kit for the current biome.
 */
export interface SceneryKit {
  /** Roadside trees, picked per slot by a stable hash. */
  trees: readonly string[];
  /** Small verge accent (flowers, café parasol, lamp…). */
  accent: string;
  /** The big landmark building. */
  landmark: string;
}

function sceneryHash(n: number): number {
  const x = Math.sin(n * 127.1 + 11.7) * 43758.5453;
  return x - Math.floor(x);
}

/** Resolve a baked scenery slot to the concrete sprite for the current stage. */
export function resolveScenerySprite(name: string, kit: SceneryKit | undefined, seed: number): string {
  if (!kit || !name.startsWith('slot:')) return name;
  const slot = name.slice(5);
  if (slot === 'tree') return kit.trees[Math.floor(sceneryHash(seed) * kit.trees.length) % kit.trees.length];
  if (slot === 'accent') return kit.accent;
  if (slot === 'landmark') return kit.landmark;
  return name;
}

const SCENERY_KITS: readonly SceneryKit[] = [
  // 1 AMALFI COAST — palms + cypress, rose verges, pastel villa.
  { trees: ['prop-palm', 'prop-cypress'], accent: 'prop-flowers', landmark: 'prop-villa' },
  // 2 TROPICO BAY — coconut palms, café parasols, thatched beach hut.
  { trees: ['prop-coconut', 'prop-palm'], accent: 'prop-parasol', landmark: 'prop-beachhut' },
  // 3 ALPINE PASS — snow firs, roadside lamps, timber chalet.
  { trees: ['prop-fir'], accent: 'prop-lamp', landmark: 'prop-chalet' },
  // 4 DESERT MESA — saguaro cacti, adobe pueblo.
  { trees: ['prop-cactus'], accent: 'prop-cactus', landmark: 'prop-adobe' },
  // 5 NEON CITY — mostly lamps with occasional arcade pylons, so the skyline
  // and billboards stay visible instead of becoming a wall of repeated signs.
  { trees: ['prop-lamp', 'prop-lamp', 'prop-neon'], accent: 'prop-lamp', landmark: 'prop-skyscraper' },
  // 6 CHERRY VALLEY — cherry blossom, flower verges, pagoda.
  { trees: ['prop-blossom'], accent: 'prop-flowers', landmark: 'prop-pagoda' },
  // 7 AUTUMN FOREST — autumn maples, flower verges, red barn.
  { trees: ['prop-maple'], accent: 'prop-flowers', landmark: 'prop-barn' },
  // 8 SALT LAKE — pampas reeds, striped lighthouse.
  { trees: ['prop-reed'], accent: 'prop-reed', landmark: 'prop-lighthouse' },
  // 9 VOLCANO ROAD — charred dead trees, glowing lava rock.
  { trees: ['prop-deadtree'], accent: 'prop-deadtree', landmark: 'prop-lavarock' },
  // 10 GOLDEN COAST — the Amalfi kit again for the run home.
  { trees: ['prop-palm', 'prop-cypress'], accent: 'prop-flowers', landmark: 'prop-villa' },
];

export function sceneryKitAt(distanceM: number): SceneryKit {
  return SCENERY_KITS[stageIndexAt(distanceM)];
}

/** The level index 0..LEVELS-1 at a distance (clamped — the finale never advances
 *  past itself, so no phantom eleventh checkpoint fires before the finish). */
export function stageIndexAt(distanceM: number): number {
  return clamp(Math.floor(Math.max(0, distanceM) / STAGE_M), 0, LEVELS - 1);
}

export function stageAt(distanceM: number): Stage {
  const index = stageIndexAt(distanceM);
  const s = STAGES[index];
  return { index, name: s.name, roster: s.roster };
}

export function rosterAt(distanceM: number): readonly string[] {
  return STAGES[stageIndexAt(distanceM)].roster;
}

// The crypto-market phase — the run's "how far have you come" flavour, kept from
// the original arc. Across the ten levels it climbs BEAR → BULL → TO THE MOON →
// NEW DAWN, landing on NEW DAWN for the finale, and rides along as a checkpoint
// subtitle under the region name so the lore survives the biome rework.
const MARKET_PHASES = ['BEAR MARKET', 'BULL RUN', 'TO THE MOON', 'NEW DAWN'] as const;

export function marketPhaseAt(distanceM: number): string {
  const level = stageIndexAt(distanceM);
  const phase = Math.min(MARKET_PHASES.length - 1, Math.floor((level * MARKET_PHASES.length) / LEVELS));
  return MARKET_PHASES[phase];
}

// ---- palette blending ------------------------------------------------------

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function rgbToHex(r: number, g: number, b: number): string {
  const c = (n: number): string => clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

function mixHex(a: string, b: string, t: number): string {
  const [r1, g1, b1] = hexToRgb(a);
  const [r2, g2, b2] = hexToRgb(b);
  return rgbToHex(r1 + (r2 - r1) * t, g1 + (g2 - g1) * t, b1 + (b2 - b1) * t);
}

function mixPalette(a: Palette, b: Palette, t: number): Palette {
  return {
    skyTop: mixHex(a.skyTop, b.skyTop, t),
    skyHorizon: mixHex(a.skyHorizon, b.skyHorizon, t),
    sea: mixHex(a.sea, b.sea, t),
    hillsFar: mixHex(a.hillsFar, b.hillsFar, t),
    hillsNear: mixHex(a.hillsNear, b.hillsNear, t),
    grassLight: mixHex(a.grassLight, b.grassLight, t),
    grassDark: mixHex(a.grassDark, b.grassDark, t),
    roadLight: mixHex(a.roadLight, b.roadLight, t),
    roadDark: mixHex(a.roadDark, b.roadDark, t),
    rumbleLight: mixHex(a.rumbleLight, b.rumbleLight, t),
    rumbleDark: mixHex(a.rumbleDark, b.rumbleDark, t),
    lane: mixHex(a.lane, b.lane, t),
    offRoadLight: mixHex(a.offRoadLight, b.offRoadLight, t),
    offRoadDark: mixHex(a.offRoadDark, b.offRoadDark, t),
    fog: mixHex(a.fog, b.fog, t),
    sun: mixHex(a.sun, b.sun, t),
    star: a.star + (b.star - a.star) * t,
  };
}

/**
 * The current leg index `k` (clamped to the finale) and the 0..1 blend `f` toward
 * the NEXT biome. `f` stays 0 for the held portion of the leg and eases up to 1
 * only across the final `TRANSITION` fraction into the checkpoint — so each region
 * looks like itself, then morphs into the next on the run-in. The FINAL leg holds
 * (`f = 0`): there is nothing after the finale to morph into before the finish.
 */
function legAt(distanceM: number): { k: number; f: number } {
  const pos = Math.max(0, distanceM) / STAGE_M;
  const k = Math.min(Math.floor(pos), LEVELS - 1);
  if (k >= LEVELS - 1) return { k: LEVELS - 1, f: 0 };
  const frac = clamp(pos - k, 0, 1);
  const f = easeInOut(clamp((frac - (1 - TRANSITION)) / TRANSITION, 0, 1));
  return { k, f };
}

/** The biome palette at a distance — the current region's colours, morphing
 *  into the next across the run-up to the checkpoint (see `legAt`). */
export function paletteAt(distanceM: number): Palette {
  const { k, f } = legAt(distanceM);
  const a = KEYFRAMES[k];
  const b = KEYFRAMES[Math.min(k + 1, LEVELS - 1)];
  return mixPalette(a, b, f);
}

export const DEFAULT_PALETTE = RIVIERA;

// Biome horizon-backdrop ids, aligned 1:1 with KEYFRAMES, used to pick which
// gpt-image panorama to crossfade underneath the road.
const BIOME_NAMES = [
  'riviera', 'beach', 'alpine', 'desert', 'city', 'valley', 'autumn', 'lake', 'volcano', 'finale',
] as const;
export type BiomeBackdrop = typeof BIOME_NAMES[number];
export type TimeOfDay = { a: BiomeBackdrop; b: BiomeBackdrop; t: number };

/** The two horizon backdrops to crossfade at a distance, and the blend 0..1 —
 *  the same leg schedule as `paletteAt`, so art and colour turn over together. */
export function timeOfDayAt(distanceM: number): TimeOfDay {
  const { k, f } = legAt(distanceM);
  return { a: BIOME_NAMES[k], b: BIOME_NAMES[Math.min(k + 1, LEVELS - 1)], t: f };
}
