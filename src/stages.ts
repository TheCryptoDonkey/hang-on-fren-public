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

/** What MATERIAL the verge slab is made of — drives the pixel detail the
 *  renderer scatters over it (tufts on grass, grain on sand, glints on snow…),
 *  so sand reads as sand rather than a repaint of the same flat lawn. */
export type GroundKind = 'grass' | 'sand' | 'snow' | 'salt' | 'leaves' | 'ash' | 'asphalt';

export interface Palette {
  skyTop: string;
  skyHorizon: string;
  sea: string;
  hillsFar: string;
  hillsNear: string;
  /** The roadside verge slab (grass / sand / snow / dust… per biome). */
  grassLight: string;
  grassDark: string;
  ground: GroundKind;
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
  grassLight: '#7cc36a', grassDark: '#71b860', ground: 'grass',
  roadLight: '#8b909a', roadDark: '#83888f',
  rumbleLight: '#f4f4f4', rumbleDark: '#d24b4b', lane: '#f5f2e8',
  offRoadLight: '#c9a86a', offRoadDark: '#bf9e60', fog: '#cfeaf0',
  sun: '#fff6d6', star: 0,
};

// 2. TROPICO BAY — tropical seaside: golden sand verges, turquoise lagoon.
const BEACH: Palette = {
  skyTop: '#3fc0e8', skyHorizon: '#dcf7f2', sea: '#12b3c4',
  hillsFar: '#8fd8d0', hillsNear: '#e0c98a',
  grassLight: '#efd9a3', grassDark: '#e6cd90', ground: 'sand',
  roadLight: '#9a9a94', roadDark: '#90908a',
  rumbleLight: '#fff6e0', rumbleDark: '#ff7a4d', lane: '#fff3d8',
  offRoadLight: '#e8cf94', offRoadDark: '#dcc078', fog: '#e0f7f0',
  sun: '#fff2c0', star: 0,
};

// 3. ALPINE PASS — cold mountain road: snow verges, misty grey-blue peaks.
const ALPINE: Palette = {
  skyTop: '#5f93c8', skyHorizon: '#d6e6f2', sea: '#5f86a8',
  hillsFar: '#9fb2c8', hillsNear: '#8fa8bf',
  grassLight: '#eef4fb', grassDark: '#dce6f0', ground: 'snow',
  roadLight: '#8f96a0', roadDark: '#868d97',
  rumbleLight: '#ffffff', rumbleDark: '#8fa3b8', lane: '#eef4fb',
  offRoadLight: '#e2ecf5', offRoadDark: '#cdd8e4', fog: '#e6eef6',
  sun: '#fdfbff', star: 0.05,
};

// 4. DESERT MESA — hot red-rock canyon: dusty sand verges, terracotta rumble.
const DESERT: Palette = {
  skyTop: '#57b4dd', skyHorizon: '#f0d9a0', sea: '#c98f5a',
  hillsFar: '#c98f5a', hillsNear: '#b0713e',
  grassLight: '#e6b878', grassDark: '#dcac6c', ground: 'sand',
  roadLight: '#9a938a', roadDark: '#918a82',
  rumbleLight: '#fff0d0', rumbleDark: '#c2502a', lane: '#fff0d0',
  offRoadLight: '#d8a860', offRoadDark: '#cc9a52', fog: '#f0dcb0',
  sun: '#fff2c8', star: 0,
};

// 5. NEON CITY — synthwave night city: dark asphalt verges, neon rumble.
const CITY: Palette = {
  skyTop: '#0b1030', skyHorizon: '#3a2a5a', sea: '#141a3a',
  hillsFar: '#2a2050', hillsNear: '#3a2a5a',
  grassLight: '#2f3550', grassDark: '#272c44', ground: 'asphalt',
  roadLight: '#3a3f4a', roadDark: '#33383f',
  rumbleLight: '#ffd76b', rumbleDark: '#ff4d6d', lane: '#ffe9a8',
  offRoadLight: '#2a2f40', offRoadDark: '#232838', fog: '#2a2440',
  sun: '#dfe6ff', star: 0.85,
};

// 6. CHERRY VALLEY — fresh green valley strewn with pink blossom, pink rumble.
const VALLEY: Palette = {
  skyTop: '#7ac8ea', skyHorizon: '#e6f2ee', sea: '#5fa9c8',
  hillsFar: '#9fd0e0', hillsNear: '#7bbf7a',
  grassLight: '#8fd07a', grassDark: '#83c66e', ground: 'grass',
  roadLight: '#8b909a', roadDark: '#83888f',
  rumbleLight: '#ffffff', rumbleDark: '#e86a9a', lane: '#fef0f5',
  offRoadLight: '#8fc47a', offRoadDark: '#83b96e', fog: '#e8f2ee',
  sun: '#fff6d6', star: 0,
};

// 7. AUTUMN FOREST — rust-and-gold woods: golden-leaf verges, amber haze.
const AUTUMN: Palette = {
  skyTop: '#6fb3d8', skyHorizon: '#f0e2c0', sea: '#5a86a0',
  hillsFar: '#c99a5a', hillsNear: '#b5702f',
  grassLight: '#d9a24e', grassDark: '#cf9644', ground: 'leaves',
  roadLight: '#8f8a82', roadDark: '#87827a',
  rumbleLight: '#fff0d0', rumbleDark: '#c2502a', lane: '#ffeccd',
  offRoadLight: '#cf9040', offRoadDark: '#c38638', fog: '#f0e0c0',
  sun: '#ffe6b0', star: 0,
};

// 8. SALT LAKE — serene pink-salt mirror flats: pale lilac verges, salt rumble.
const SALT: Palette = {
  skyTop: '#8fbfe0', skyHorizon: '#eaf2f6', sea: '#bfe0e6',
  hillsFar: '#c8d4dc', hillsNear: '#b0c0c8',
  grassLight: '#e6dfe8', grassDark: '#dcd4de', ground: 'salt',
  roadLight: '#9a9aa2', roadDark: '#92929a',
  rumbleLight: '#ffffff', rumbleDark: '#c98fb0', lane: '#f4eef6',
  offRoadLight: '#ded6e0', offRoadDark: '#d2cad4', fog: '#eef2f4',
  sun: '#fff2e0', star: 0,
};

// 9. VOLCANO ROAD — ash sky and black lava: charred verges, ember rumble.
const VOLCANO: Palette = {
  skyTop: '#3a1420', skyHorizon: '#8a3a2a', sea: '#c8401a',
  hillsFar: '#5a2a30', hillsNear: '#3a1c1e',
  grassLight: '#4a2e2e', grassDark: '#3e2626', ground: 'ash',
  roadLight: '#2e2a2c', roadDark: '#282428',
  rumbleLight: '#ffb44d', rumbleDark: '#e5401a', lane: '#ff9d4d',
  offRoadLight: '#3a2626', offRoadDark: '#301e1e', fog: '#5a2a24',
  sun: '#ff7a3c', star: 0.15,
};

// 10. GOLDEN COAST — triumphant golden-hour Riviera finale: lush green, gold rumble.
const FINALE: Palette = {
  skyTop: '#3aa0e0', skyHorizon: '#ffe6b0', sea: '#1f7fbe',
  hillsFar: '#8fb0c8', hillsNear: '#5c9f6a',
  grassLight: '#8fd07a', grassDark: '#83c66e', ground: 'grass',
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
  grassLight: '#6f8f62', grassDark: '#648457', ground: 'grass',
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
  grassLight: '#84b06a', grassDark: '#79a55f', ground: 'grass',
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
  grassLight: '#a8b874', grassDark: '#9dad69', ground: 'grass',
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
  grassLight: '#7cb86a', grassDark: '#71ad60', ground: 'grass',
  roadLight: '#9a959e', roadDark: '#928d96',
  rumbleLight: '#ffffff', rumbleDark: '#e5344e', lane: '#fff0f4',
  offRoadLight: '#c98a94', offRoadDark: '#bd7e88', fog: '#f6dfe2',
  sun: '#fff0dc', star: 0,
};

const WORLD_KEYFRAMES: readonly Palette[] = [MANCHESTER, PRAGUE, MALLORCA, TAJ];

// Each region drives its OWN traffic: the vehicles you meet belong to the place
// you're riding through — coaches and ploughs on the mountain, pickups and
// buggies in the canyon, taxis and squad cars in the city, tractors in the
// valley. Supercars are reserved for the roads that earn them (the flats, the
// lava run, the golden finale), so the roster itself tells you where you are.
const STAGES: readonly { name: string; roster: readonly string[] }[] = [
  // 1 Amalfi — old-money Italian traffic and a holiday camper on the coast road.
  { name: 'AMALFI COAST', roster: ['car-classic', 'car-van', 'car-camper'] },
  // 2 Tropico Bay — beach campers and open-top cruisers; the red-helmet scooter
  // is the unique persistent Fren rival now, never anonymous traffic.
  { name: 'TROPICO BAY', roster: ['car-camper', 'car-porsche', 'car-classic'] },
  // 3 Alpine Pass — coaches and the snow plough that keeps the pass open.
  { name: 'ALPINE PASS', roster: ['car-bus', 'car-plough', 'car-bentley'] },
  // 4 Desert Mesa — pickups, dune buggies and dusty beaters crossing the canyon.
  { name: 'DESERT MESA', roster: ['car-pickup', 'car-buggy', 'car-banger'] },
  // 5 Neon City — cabs, squad cars and a supercar tearing through the night.
  { name: 'NEON CITY', roster: ['car-taxi', 'car-police', 'car-ferrari'] },
  // 6 Cherry Valley — tractors and country traffic through the blossom.
  { name: 'CHERRY VALLEY', roster: ['car-tractor', 'car-classic', 'car-van'] },
  // 7 Autumn Forest — campers and farm traffic on the woodland road.
  { name: 'AUTUMN FOREST', roster: ['car-camper', 'car-tractor', 'car-bentley'] },
  // 8 Salt Lake — record machines and buggies skating the flats.
  { name: 'SALT LAKE', roster: ['car-buggy', 'car-porsche', 'car-lambo'] },
  // 9 Volcano Road — service jeeps and the fire truck standing by on the lava.
  { name: 'VOLCANO ROAD', roster: ['car-jeep', 'car-firetruck', 'car-banger'] },
  // 10 Golden Coast — a grand supercar field for the run home.
  { name: 'GOLDEN COAST', roster: ['car-ferrari', 'car-lambo', 'car-porsche'] },
];

const WORLD_STAGES: readonly { name: string; roster: readonly string[] }[] = [
  // W1 Old Manchester — city working traffic: buses, cabs, vans.
  { name: 'OLD MANCHESTER', roster: ['car-bus', 'car-taxi', 'car-van'] },
  // W2 Old Prague — trams give way to coaches and stately machines on the cobbles.
  { name: 'OLD PRAGUE', roster: ['car-bus', 'car-classic', 'car-bentley'] },
  // W3 Old Mallorca — island holiday-makers: campers and cruisers on the terraces.
  { name: 'OLD MALLORCA', roster: ['car-camper', 'car-porsche', 'car-classic'] },
  // W4 Taj Mahal — a grand closing procession of coaches and tourers.
  { name: 'TAJ MAHAL', roster: ['car-bus', 'car-bentley', 'car-ferrari'] },
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

// --- roadside terrain -------------------------------------------------------

/**
 * What the ground does beyond the verge on each side — the thing that makes the
 * road read as a PLACE rather than a ribbon on a lawn: a rock wall climbing away
 * on one shoulder, the ground falling off a cliff to the sea on the other.
 *
 * - `cliff` — a rock wall rising from the verge (drawn upward, occludes the sky)
 * - `sea`   — the ground stops and the water starts (a drop to the coast)
 * - `drop`  — the ground falls away into haze (a canyon / valley / lava field)
 * - `flat`  — open ground running to the horizon (the default, no extra geometry)
 */
export type SideKind = 'cliff' | 'sea' | 'drop' | 'flat';

export interface Terrain {
  left: SideKind;
  right: SideKind;
  /** Rock-face colours for a `cliff` side (banded light/dark like the road). */
  cliffLight: string;
  cliffDark: string;
  /** What a `drop` side falls into (canyon floor / lava / valley haze). */
  dropColor: string;
  /** How tall a `cliff` wall stands, in world units (camera height is ~1150). */
  cliffHeight: number;
}

const FLAT_TERRAIN: Terrain = {
  left: 'flat', right: 'flat',
  cliffLight: '#9aa6b4', cliffDark: '#7f8b99', dropColor: '#b9cbdc', cliffHeight: 2000,
};

// One per grand-tour region, in journey order (aligned with STAGES/KEYFRAMES).
const TERRAIN: readonly Terrain[] = [
  // 1 AMALFI — the postcard: limestone wall inland, sheer drop to the bay.
  { left: 'cliff', right: 'sea', cliffLight: '#b9a98c', cliffDark: '#9c8c72', dropColor: '#1f6fae', cliffHeight: 3400 },
  // 2 TROPICO BAY — low dunes inland, turquoise lagoon seaward.
  { left: 'flat', right: 'sea', cliffLight: '#d8c08e', cliffDark: '#c2a878', dropColor: '#12b3c4', cliffHeight: 1400 },
  // 3 ALPINE PASS — rock face on the mountain side, valley falling away.
  { left: 'cliff', right: 'drop', cliffLight: '#9aa6b4', cliffDark: '#7f8b99', dropColor: '#b9cbdc', cliffHeight: 5200 },
  // 4 DESERT MESA — red-rock mesa one side, canyon the other.
  { left: 'cliff', right: 'drop', cliffLight: '#c07a48', cliffDark: '#a35f34', dropColor: '#d8a860', cliffHeight: 4200 },
  // 5 NEON CITY — concrete retaining walls hemming the expressway in.
  { left: 'cliff', right: 'cliff', cliffLight: '#3a3f52', cliffDark: '#2c3040', dropColor: '#141a3a', cliffHeight: 2200 },
  // 6 CHERRY VALLEY — open blossom country either side.
  { left: 'flat', right: 'flat', cliffLight: '#8fbf7a', cliffDark: '#79a866', dropColor: '#9fd0e0', cliffHeight: 1600 },
  // 7 AUTUMN FOREST — a wooded bank rising on the inland shoulder.
  { left: 'cliff', right: 'flat', cliffLight: '#8a6a3e', cliffDark: '#6f5430', dropColor: '#c99a5a', cliffHeight: 2400 },
  // 8 SALT LAKE — flats inland, the pink mirror lake to seaward.
  { left: 'flat', right: 'sea', cliffLight: '#cfc6d2', cliffDark: '#b8aebd', dropColor: '#bfe0e6', cliffHeight: 1200 },
  // 9 VOLCANO ROAD — black basalt wall, a glowing lava field falling away.
  { left: 'cliff', right: 'drop', cliffLight: '#4a3a38', cliffDark: '#332726', dropColor: '#c8401a', cliffHeight: 4600 },
  // 10 GOLDEN COAST — the Amalfi profile again, lit gold for the run home.
  { left: 'cliff', right: 'sea', cliffLight: '#c2ab84', cliffDark: '#a38e6b', dropColor: '#1f7fbe', cliffHeight: 3400 },
];

// One per world-tour region (Manchester → Prague → Mallorca → Taj Mahal).
const WORLD_TERRAIN: readonly Terrain[] = [
  // W1 OLD MANCHESTER — brick mill walls hemming the road.
  { left: 'cliff', right: 'cliff', cliffLight: '#7a5348', cliffDark: '#5e3f36', dropColor: '#6a6a70', cliffHeight: 2600 },
  // W2 OLD PRAGUE — stone embankments above the river.
  { left: 'cliff', right: 'flat', cliffLight: '#b0a48c', cliffDark: '#938872', dropColor: '#8fa6b8', cliffHeight: 2400 },
  // W3 OLD MALLORCA — cliff road above the Mediterranean.
  { left: 'cliff', right: 'sea', cliffLight: '#c2ab84', cliffDark: '#a38e6b', dropColor: '#1f8fbe', cliffHeight: 3200 },
  // W4 TAJ MAHAL — open gardens either side of the approach.
  { left: 'flat', right: 'flat', cliffLight: '#c8b48c', cliffDark: '#b09a72', dropColor: '#cfe0d0', cliffHeight: 1600 },
];

function activeTerrain(): readonly Terrain[] {
  return activeTour === 'world' ? WORLD_TERRAIN : TERRAIN;
}

export function terrainAt(distanceM: number): Terrain {
  return activeTerrain()[stageIndexAt(distanceM)];
}

export const DEFAULT_TERRAIN = FLAT_TERRAIN;

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
    ground: t < 0.5 ? a.ground : b.ground,
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
