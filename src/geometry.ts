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
  'car-classic': 0.32,
  'car-van': 0.3,
  'scooter-rival': 0.16,
  'car-lambo': 0.34,
  'car-ferrari': 0.34,
  'car-porsche': 0.32,
  'car-bentley': 0.32,
  'car-banger': 0.3,
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
  // road-spanning gate / finish arches (wider than the tarmac so posts sit off it)
  'prop-gate': 2.7,
  'prop-finish': 2.7,
  'prop-chevron-left': 0.62,
  'prop-chevron-right': 0.62,
};

export const DEFAULT_SPRITE_WIDTH = 0.3;

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
  return SPRITE_WORLD_WIDTH[baseSprite(sprite)] ?? DEFAULT_SPRITE_WIDTH;
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
  // Soft verge dressing: drawn for speed/parallax, not as crash hazards.
  'prop-flowers': null,
  'prop-reed': null,
  // Marker arches are driven through and handled separately as non-colliding.
  'prop-gate': null,
  'prop-finish': null,
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
