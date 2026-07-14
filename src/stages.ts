// OutRun-style regions: the drive is a FINITE journey through visually distinct
// BIOMES that ends at a FINISH LINE rather than looping. Two TOURS share this
// machinery: the ten-level GRAND TOUR (Amalfi out across the world and back to
// a golden coast) and the four-level 600B WORLD TOUR — the conference circuit
// through historical Manchester, Prague and Mallorca, closing at a
// rose-drenched Taj Mahal.
//
// The biome PALETTE (verge/sea/hills colours) morphs smoothly into the next
// across the run-up to each checkpoint, while the scenery KIT, region NAME and
// car ROSTER hard-swap at the checkpoint boundary. The final leg holds its biome
// all the way to the finish (there is nothing after it to morph into).
//
// Data-only with no render/DOM deps. The one piece of state is which tour is
// active (setActiveTour) — a run rides exactly one tour, main.ts sets it at
// startRun, and tests set/reset it explicitly.

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

/** How many levels/regions the GRAND TOUR is made of. */
export const LEVELS = 10;
/** Metres of road per stage / between checkpoints (both tours). 4.2 km turns
 *  the ten-region trip into a proper 42 km grand tour (and keeps the game's
 *  4.20 / 42 lore), long enough for each biome and its road features to
 *  establish a rhythm. */
export const STAGE_M = 4200;
/** Distance at which the GRAND TOUR finish line sits. */
export const FINISH_M = LEVELS * STAGE_M;
/** How many levels the 600B WORLD TOUR is made of. */
export const WORLD_LEVELS = 4;
/** Seconds granted when the rider crosses into a new stage (OutRun checkpoint).
 *  The longer 4.2 km legs earn a full petrol-can-sized top-up. */
export const CHECKPOINT_BONUS = 21;
/** Fraction of a leg (measured from its end) over which the biome morphs into
 *  the next one. The biome is held for the rest of the leg so each region reads
 *  as its own distinct place, with the change happening on the run into the
 *  checkpoint. Shared by the palette blend and the horizon crossfade. */
export const TRANSITION = 0.22;

// --- tours -------------------------------------------------------------------

/** Which journey a run rides: the main grand tour, or the 600B world tour
 *  (the conference circuit — see WORLD_STAGES). */
export type TourId = 'grand' | 'world';

export const TOUR_TITLES: Record<TourId, string> = {
  grand: 'GRAND TOUR',
  world: '600B WORLD TOUR',
};

let activeTour: TourId = 'grand';

/** Select the tour every distance-keyed lookup below reads from. A run rides
 *  exactly one tour: main.ts sets this at startRun and never mid-run. */
export function setActiveTour(tour: TourId): void {
  activeTour = tour;
}

export function getActiveTour(): TourId {
  return activeTour;
}

/** Levels in the ACTIVE tour. */
export function levelCount(): number {
  return activeTour === 'world' ? WORLD_LEVELS : LEVELS;
}

/** Finish-line distance of the ACTIVE tour. */
export function finishDistanceM(): number {
  return levelCount() * STAGE_M;
}

function activeKeyframes(): readonly Palette[] {
  return activeTour === 'world' ? WORLD_KEYFRAMES : KEYFRAMES;
}

function activeStages(): readonly { name: string; roster: readonly string[] }[] {
  return activeTour === 'world' ? WORLD_STAGES : STAGES;
}

function activeKits(): readonly SceneryKit[] {
  return activeTour === 'world' ? WORLD_SCENERY_KITS : SCENERY_KITS;
}

function activeBiomes(): readonly BiomeBackdrop[] {
  return activeTour === 'world' ? WORLD_BIOME_NAMES : BIOME_NAMES;
}

/** True where the treat lottery should be dominated by roses — the Taj Mahal
 *  finale of the world tour is one long rose garden. */
export function roseRichAt(distanceM: number): boolean {
  return activeTour === 'world' && stageIndexAt(distanceM) === WORLD_LEVELS - 1;
}

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

// --- 600B WORLD TOUR palettes (the post-game conference circuit) -------------

// W1. OLD MANCHESTER — Cottonopolis: pale overcast sky, canal water, soot-washed
// verges, cobble-grey road and red-brick rumble.
const MANCHESTER: Palette = {
  skyTop: '#7a8fa6', skyHorizon: '#d9d2c0', sea: '#4a6a62',
  hillsFar: '#8a8a92', hillsNear: '#7a5444',
  grassLight: '#6f8f62', grassDark: '#648457',
  roadLight: '#8a8580', roadDark: '#827d78',
  rumbleLight: '#e8e0d0', rumbleDark: '#a03a2a', lane: '#e8e4d8',
  offRoadLight: '#9a8a72', offRoadDark: '#8f7f68', fog: '#cfc9ba',
  sun: '#f5efdc', star: 0,
};

// W2. OLD PRAGUE — the city of a hundred spires in golden light: Vltava blue,
// terracotta rooftops, warm cobbles.
const PRAGUE: Palette = {
  skyTop: '#4a90c8', skyHorizon: '#f2ddb0', sea: '#3a6f9e',
  hillsFar: '#b08a5a', hillsNear: '#8f5a3a',
  grassLight: '#84b06a', grassDark: '#79a55f',
  roadLight: '#8f8a84', roadDark: '#87827c',
  rumbleLight: '#f4ead0', rumbleDark: '#b8552e', lane: '#f2ecd8',
  offRoadLight: '#c0a06a', offRoadDark: '#b4945e', fog: '#ecdfc0',
  sun: '#ffedc0', star: 0,
};

// W3. OLD MALLORCA — Tramuntana stone country: bright Mediterranean sea, olive
// terraces, limestone dust, sandstone-gold rumble.
const MALLORCA: Palette = {
  skyTop: '#2f9fd8', skyHorizon: '#cfeef2', sea: '#1a7fb4',
  hillsFar: '#b0b8a0', hillsNear: '#8a9a6a',
  grassLight: '#a8b874', grassDark: '#9dad69',
  roadLight: '#948f88', roadDark: '#8c8780',
  rumbleLight: '#fdf6e4', rumbleDark: '#c98f3c', lane: '#fbf3dc',
  offRoadLight: '#d4b878', offRoadDark: '#c8ac6c', fog: '#dff0ea',
  sun: '#fff6d0', star: 0,
};

// W4. TAJ MAHAL — dawn over the rose gardens: pink sky, marble haze, the
// reflecting pool, petal-strewn verges and a rose-red rumble.
const TAJ: Palette = {
  skyTop: '#d87a9a', skyHorizon: '#ffe0d0', sea: '#7ab8c8',
  hillsFar: '#cfa0b4', hillsNear: '#9a6a7e',
  grassLight: '#7cb86a', grassDark: '#71ad60',
  roadLight: '#9a959e', roadDark: '#928d96',
  rumbleLight: '#ffffff', rumbleDark: '#e5344e', lane: '#fff0f4',
  offRoadLight: '#c98a94', offRoadDark: '#bd7e88', fog: '#f6dfe2',
  sun: '#fff0dc', star: 0,
};

const WORLD_KEYFRAMES: readonly Palette[] = [MANCHESTER, PRAGUE, MALLORCA, TAJ];

const STAGES: readonly { name: string; roster: readonly string[] }[] = [
  // 1 Amalfi — old-money Italian traffic pottering along the coast road.
  { name: 'AMALFI COAST', roster: ['car-classic', 'car-van', 'car-banger'] },
  // 2 Tropico Bay — holiday convertibles; the red-helmet scooter is now the
  // unique persistent Fren rival, never anonymous traffic.
  { name: 'TROPICO BAY', roster: ['car-porsche', 'car-ferrari', 'car-bentley'] },
  // 3 Alpine Pass — grand tourers hauling up the mountain.
  { name: 'ALPINE PASS', roster: ['car-bentley', 'car-lambo', 'car-classic'] },
  // 4 Desert Mesa — dusty beaters and vans crossing the canyon.
  { name: 'DESERT MESA', roster: ['car-banger', 'car-van', 'car-classic'] },
  // 5 Neon City — supercars tearing through the night.
  { name: 'NEON CITY', roster: ['car-ferrari', 'car-lambo', 'car-porsche'] },
  // 6 Cherry Valley — gentle country traffic through the blossom.
  { name: 'CHERRY VALLEY', roster: ['car-banger', 'car-classic', 'car-van'] },
  // 7 Autumn Forest — stately tourers on the woodland road.
  { name: 'AUTUMN FOREST', roster: ['car-bentley', 'car-banger', 'car-classic'] },
  // 8 Salt Lake — fast machines skating the flats.
  { name: 'SALT LAKE', roster: ['car-porsche', 'car-lambo', 'car-ferrari'] },
  // 9 Volcano Road — dramatic exotics on the lava road.
  { name: 'VOLCANO ROAD', roster: ['car-lambo', 'car-ferrari', 'car-bentley'] },
  // 10 Golden Coast — a grand finale field for the run home.
  { name: 'GOLDEN COAST', roster: ['car-ferrari', 'car-lambo', 'car-bentley'] },
];

const WORLD_STAGES: readonly { name: string; roster: readonly string[] }[] = [
  // W1 Old Manchester — working traffic between the mills.
  { name: 'OLD MANCHESTER', roster: ['car-classic', 'car-van', 'car-banger'] },
  // W2 Old Prague — stately machines on the cobbles.
  { name: 'OLD PRAGUE', roster: ['car-classic', 'car-banger', 'car-bentley'] },
  // W3 Old Mallorca — island holiday-makers on the terrace roads.
  { name: 'OLD MALLORCA', roster: ['car-porsche', 'car-classic', 'car-van'] },
  // W4 Taj Mahal — a grand closing procession.
  { name: 'TAJ MAHAL', roster: ['car-bentley', 'car-ferrari', 'car-lambo'] },
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

const WORLD_SCENERY_KITS: readonly SceneryKit[] = [
  // W1 OLD MANCHESTER — gas lamps and soot-dark trees between the cotton mills.
  { trees: ['prop-lamp', 'prop-maple'], accent: 'prop-lamp', landmark: 'prop-mill' },
  // W2 OLD PRAGUE — linden avenues, flower boxes, the astronomical clock tower.
  { trees: ['prop-maple', 'prop-lamp'], accent: 'prop-flowers', landmark: 'prop-clocktower' },
  // W3 OLD MALLORCA — palms and cypress on the terraces, café parasols, stone windmills.
  { trees: ['prop-palm', 'prop-cypress'], accent: 'prop-parasol', landmark: 'prop-windmill' },
  // W4 TAJ MAHAL — charbagh cypress avenues, ROSES everywhere, the mausoleum itself.
  { trees: ['prop-cypress', 'prop-blossom'], accent: 'prop-flowers', landmark: 'prop-tajmahal' },
];

export function sceneryKitAt(distanceM: number): SceneryKit {
  return activeKits()[stageIndexAt(distanceM)];
}

/** The level index (0..levelCount()-1) at a distance in the ACTIVE tour
 *  (clamped — the finale never advances past itself, so no phantom extra
 *  checkpoint fires before the finish). */
export function stageIndexAt(distanceM: number): number {
  return clamp(Math.floor(Math.max(0, distanceM) / STAGE_M), 0, levelCount() - 1);
}

export function stageAt(distanceM: number): Stage {
  const index = stageIndexAt(distanceM);
  const s = activeStages()[index];
  return { index, name: s.name, roster: s.roster };
}

export function rosterAt(distanceM: number): readonly string[] {
  return activeStages()[stageIndexAt(distanceM)].roster;
}

// The checkpoint subtitle arc — the run's "how far have you come" flavour. The
// grand tour keeps the crypto-market phases from the original arc (BEAR → BULL
// → TO THE MOON → NEW DAWN); the world tour rides the 600B conference schedule
// instead, one phase per city, closing on the gala at the Taj.
const MARKET_PHASES = ['BEAR MARKET', 'BULL RUN', 'TO THE MOON', 'NEW DAWN'] as const;
const CONFERENCE_PHASES = ['REGISTRATION DAY', 'KEYNOTE DAY', 'PANEL MARATHON', 'CLOSING GALA'] as const;

export function marketPhaseAt(distanceM: number): string {
  const phases: readonly string[] = activeTour === 'world' ? CONFERENCE_PHASES : MARKET_PHASES;
  const level = stageIndexAt(distanceM);
  const phase = Math.min(phases.length - 1, Math.floor((level * phases.length) / levelCount()));
  return phases[phase];
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
  const levels = levelCount();
  const pos = Math.max(0, distanceM) / STAGE_M;
  const k = Math.min(Math.floor(pos), levels - 1);
  if (k >= levels - 1) return { k: levels - 1, f: 0 };
  const frac = clamp(pos - k, 0, 1);
  const f = easeInOut(clamp((frac - (1 - TRANSITION)) / TRANSITION, 0, 1));
  return { k, f };
}

/** The biome palette at a distance — the current region's colours, morphing
 *  into the next across the run-up to the checkpoint (see `legAt`). */
export function paletteAt(distanceM: number): Palette {
  const { k, f } = legAt(distanceM);
  const frames = activeKeyframes();
  const a = frames[k];
  const b = frames[Math.min(k + 1, levelCount() - 1)];
  return mixPalette(a, b, f);
}

export const DEFAULT_PALETTE = RIVIERA;

// Biome horizon-backdrop ids, aligned 1:1 with each tour's keyframes, used to
// pick which gpt-image panorama to crossfade underneath the road.
const BIOME_NAMES = [
  'riviera', 'beach', 'alpine', 'desert', 'city', 'valley', 'autumn', 'lake', 'volcano', 'finale',
] as const;
const WORLD_BIOME_NAMES = ['manchester', 'prague', 'mallorca', 'tajmahal'] as const;
export type BiomeBackdrop = typeof BIOME_NAMES[number] | typeof WORLD_BIOME_NAMES[number];
export type TimeOfDay = { a: BiomeBackdrop; b: BiomeBackdrop; t: number };

/** The two horizon backdrops to crossfade at a distance, and the blend 0..1 —
 *  the same leg schedule as `paletteAt`, so art and colour turn over together. */
export function timeOfDayAt(distanceM: number): TimeOfDay {
  const { k, f } = legAt(distanceM);
  const biomes = activeBiomes();
  return { a: biomes[k], b: biomes[Math.min(k + 1, levelCount() - 1)], t: f };
}
