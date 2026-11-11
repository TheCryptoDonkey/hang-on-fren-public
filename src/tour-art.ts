// Staged art loading. Most sprites are shared by every tour and gate the title
// screen (see loadSpritesInto in boot). The full-bleed horizon backdrops are
// the exception: each is a 1280x853 canvas (4.2 MB resident) and a tour draws
// only its own handful, so they load per tour when a run starts and the
// previous tour's are dropped.
//
// Only the horizons are staged because they are the art that needs no pixel
// readback: loadFullBleed is decode plus one blit. Trimmed sprites (vehicles,
// props, the stone-age set) still scan unless the trim manifest marks them
// clean, and a scan must not run once the title is interactive, so they stay in
// the title gate.

import { ART_URLS, loadSprite, type SpriteStore } from './sprites.js';
import { openingHorizons, tourHorizons, type TourId } from './stages.js';

const TOURS: readonly TourId[] = ['grand', 'world', 'stone'];

const horizonSprite = (backdrop: string): string => `horizon-${backdrop}`;

/** Sprite names for a tour's horizons, in the order its legs reach them. */
export function tourArt(tour: TourId): readonly string[] {
  return tourHorizons(tour).map(horizonSprite);
}

/** The horizons a tour needs from its first metre: gate the run on these. */
export function openingArt(tour: TourId): readonly string[] {
  return openingHorizons(tour).map(horizonSprite);
}

/** Every staged sprite name, across all tours. */
export function stagedArt(): ReadonlySet<string> {
  return new Set(TOURS.flatMap(tour => tourArt(tour)));
}

/** What the title screen and every tour share: all art that is not staged. */
export function titleArt(): string[] {
  const staged = stagedArt();
  return Object.keys(ART_URLS).filter(name => !staged.has(name));
}

let current: TourId | null = null;
let streaming: TourId | null = null;
const inflight = new Map<string, Promise<void>>();

/** Load one staged sprite into the store, once, and only while a tour that
 *  uses it is still the one being prepared (a late arrival from a tour the
 *  player has since left must not pin its canvas). */
function loadStaged(store: SpriteStore, name: string): Promise<void> {
  const known = inflight.get(name);
  if (known) return known;
  const job = loadSprite(name)
    .then(sprite => {
      if (sprite && current && tourArt(current).includes(name)) store.set(name, sprite);
    })
    .catch(() => undefined)
    .finally(() => { inflight.delete(name); });
  inflight.set(name, job);
  return job;
}

export interface EnsureOptions {
  /** Also stream the rest of the tour's horizons, in leg order, once the
   *  opening ones are in. Off for the idle prefetch on the title. */
  streamRest?: boolean;
  onProgress?: (done: number, total: number) => void;
}

/**
 * Make a tour's opening horizons resident and drop every other tour's.
 * Returns null when they already are (nothing to wait for), otherwise a
 * promise that settles when the opening ones have landed. Safe to call again
 * for the same tour (in-flight loads are shared); the remaining horizons keep
 * streaming behind it without blocking, and the renderer falls back to its
 * code-drawn backdrop for any that is not in yet.
 */
export function ensureTourArt(store: SpriteStore, tour: TourId, options: EnsureOptions = {}): Promise<void> | null {
  current = tour;
  const wanted = new Set(tourArt(tour));
  for (const name of stagedArt()) if (!wanted.has(name)) store.delete(name);

  const stream = async (): Promise<void> => {
    if (streaming === tour) return;
    streaming = tour;
    try {
      for (const name of tourArt(tour)) {
        if (current !== tour) return;
        if (!store.has(name)) await loadStaged(store, name);
      }
    } finally {
      if (streaming === tour) streaming = null;
    }
  };

  const missing = openingArt(tour).filter(name => !store.has(name));
  if (missing.length === 0) {
    if (options.streamRest) void stream();
    return null;
  }
  const total = missing.length;
  let done = 0;
  return Promise.all(missing.map(name => loadStaged(store, name).then(() => {
    done += 1;
    options.onProgress?.(done, total);
  }))).then(() => {
    if (options.streamRest) void stream();
  });
}
