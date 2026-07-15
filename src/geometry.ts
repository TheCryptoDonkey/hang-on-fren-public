// The SINGLE source of truth for how wide each sprite is, as a fraction of the
// full road width. Both the renderer (how wide a sprite is DRAWN) and collision
// (how wide its HITBOX is) read from here, so the hitbox matches what you see by
// construction. Keeping these in two hand-tuned tables — one in render.ts, one in
// world.ts — was the root of the "hit something I didn't see / drove through
// something I did" complaints: the tables drifted apart. Now they can't.

export const SPRITE_WORLD_WIDTH: Record<string, number> = {
  rose: 0.13,
  'pickup-petrol': 0.13,
  'pickup-cake': 0.14,
  'pickup-wholecake': 0.16,
  'pickup-meme': 0.14,
  'pickup-ath': 0.14,
  'pickup-timelock': 0.14,
  'pickup-fiatnam': 0.15,
  'pickup-fourtwenty': 0.14,
  'pickup-shield': 0.14,
  'pickup-beer': 0.13,
  'pickup-shroom': 0.14,
  'pickup-joint': 0.14,
  'pickup-pill': 0.11,
  'pickup-crystal': 0.14,
  'pickup-sacredstone': 0.14,
  'car-classic': 0.32,
  'car-van': 0.3,
  'scooter-rival': 0.16,
  // Prehistoric "traffic" — the dinosaurs charge AT the rider, the mammoth is a
  // slow shaggy roadblock. Widths tell the truth about their bulk.
  'dino-trex': 0.36,
  'dino-raptor': 0.24,
  mammoth: 0.42,
  // Pothole decal (drawn flat on the road; collision uses its own window).
  'hazard-hole': 0.3,
  'car-lambo': 0.34,
  'car-ferrari': 0.34,
  'car-porsche': 0.32,
  'car-bentley': 0.32,
  'car-banger': 0.3,
  // Regional working vehicles — wider (they're vans, buses, trucks, tractors),
  // so the hitbox tells the truth about their bulk.
  'car-camper': 0.32,
  'car-bus': 0.36,
  'car-plough': 0.36,
  'car-pickup': 0.32,
  'car-buggy': 0.28,
  'car-taxi': 0.32,
  'car-police': 0.32,
  'car-tractor': 0.32,
  'car-jeep': 0.31,
  'car-firetruck': 0.37,
  'prop-palm': 0.52,
  'prop-coconut': 0.5,
  'prop-cypress': 0.4,
  'prop-pine': 0.5,
  'prop-fir': 0.46,
  'prop-blossom': 0.44,
  'prop-lamp': 0.16,
  'prop-parasol': 0.34,
  'prop-flowers': 0.3,
  'prop-villa': 1.05,
  'prop-beachhut': 0.92,
  'prop-chalet': 1.0,
  'prop-sign': 0.4,
  'prop-billboard': 1.5,
  // regions 4–9 props
  'prop-cactus': 0.42,
  'prop-adobe': 1.0,
  'prop-neon': 0.4,
  'prop-skyscraper': 1.35,
  'prop-pagoda': 1.0,
  'prop-maple': 0.5,
  'prop-barn': 1.05,
  'prop-reed': 0.36,
  'prop-lighthouse': 0.7,
  'prop-deadtree': 0.44,
  'prop-lavarock': 0.9,
  // 600B world-tour landmarks
  'prop-mill': 1.2,
  'prop-clocktower': 0.75,
  'prop-windmill': 0.95,
  'prop-tajmahal': 1.5,
  // 600 BILLION BC scenery
  'prop-fern': 0.52,
  'prop-bones': 0.7,
  'prop-volcano': 1.4,
  // road-spanning gate / finish arches (wider than the tarmac so posts sit off it)
  'prop-gate': 2.7,
  'prop-finish': 2.7,
  // The flag-marshal cast waiting at the finish line — a road-hugging group you
  // ride up to, so the payoff is visible all the way down the run-in.
  'finish-line-girls': 0.8,
  'finish-line-cavewomen': 0.8,
  'prop-chevron-left': 0.62,
  'prop-chevron-right': 0.62,
};

export const DEFAULT_SPRITE_WIDTH = 0.3;

// Phone screens are small and the tokens are the thing you steer FOR — on
// touch devices they get a size boost so they read at distance. Collection
// uses its own fixed lateral window (world.ts PICKUP_GAP = 0.5, far wider
// than any drawn token even boosted), so this changes what you can SEE, not
// what you can catch.
let pickupScale = 1;

/** Set by main.ts at boot: 1 on pointer devices, >1 on touch. */
export function setPickupScale(scale: number): void {
  pickupScale = scale;
}

/**
 * Composited variants (sign-N in-jokes, billboard-N memes) share their base
 * prop's footprint — they're the same structure with different faces.
 */
function baseSprite(sprite: string): string {
  if (sprite.startsWith('sign-')) return 'prop-sign';
  if (sprite.startsWith('billboard-')) return 'prop-billboard';
  return sprite;
}

/** Drawn width of a sprite in road-offset units (full road spans -1..1 → width 2). */
export function spriteWorldWidth(sprite: string): number {
  const base = SPRITE_WORLD_WIDTH[baseSprite(sprite)] ?? DEFAULT_SPRITE_WIDTH;
  if (sprite === 'rose' || sprite.startsWith('pickup-')) return base * pickupScale;
  return base;
}

// Solid roadside footprints in road-offset units. These are intentionally not
// the full drawn widths: most props are leafy canopies, signs, houses or soft
// verge dressing with transparent/forgiving edges. This is the collision "mask"
// for world-space physics.
const SCENERY_HIT_HALF_WIDTH: Record<string, number | null> = {
  'prop-palm': 0.07,
  'prop-coconut': 0.07,
  'prop-cypress': 0.08,
  'prop-pine': 0.09,
  'prop-fir': 0.09,
  'prop-blossom': 0.08,
  'prop-cactus': 0.08,
  'prop-neon': 0.08,
  'prop-maple': 0.08,
  'prop-deadtree': 0.08,
  'prop-lamp': 0.05,
  'prop-parasol': 0.07,
  'prop-sign': 0.1,
  'prop-billboard': 0.14, // legs only — the panel floats above head height
  'prop-villa': 0.38,
  'prop-beachhut': 0.34,
  'prop-chalet': 0.36,
  'prop-adobe': 0.34,
  'prop-skyscraper': 0.42,
  'prop-pagoda': 0.34,
  'prop-barn': 0.36,
  'prop-lighthouse': 0.16,
  'prop-lavarock': 0.28,
  // 600B world-tour landmarks — solid masonry, but tighter than the drawn
  // billboard like every other building (forgiving edges).
  'prop-mill': 0.4,
  'prop-clocktower': 0.2,
  'prop-windmill': 0.26,
  'prop-tajmahal': 0.5,
  // 600 BILLION BC scenery: the fern is a trunk strike like any tree; the bones
  // and the volcano are solid enough to hurt.
  'prop-fern': 0.08,
  'prop-bones': 0.18,
  'prop-volcano': 0.4,
  // Soft verge dressing: drawn for speed/parallax, not as crash hazards.
  'prop-flowers': null,
  'prop-reed': null,
  // Marker arches are driven through and handled separately as non-colliding.
  'prop-gate': null,
  'prop-finish': null,
  'finish-line-girls': null, // the welcome party is not a crash hazard
  'finish-line-cavewomen': null,
  // Warning boards sit just beyond the verge and are guidance, not hazards.
  'prop-chevron-left': null,
  'prop-chevron-right': null,
};

export function sceneryHitHalfWidth(sprite: string): number | null {
  const name = baseSprite(sprite);
  return Object.prototype.hasOwnProperty.call(SCENERY_HIT_HALF_WIDTH, name)
    ? SCENERY_HIT_HALF_WIDTH[name]
    : 0.08;
}
