import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  setActiveTour, rosterAt, sceneryKitAt, timeOfDayAt, finishDistanceM, tourHorizons, openingHorizons, type TourId,
} from './stages.js';
import { ART_URLS, SpriteStore, type SpriteImage } from './sprites.js';

vi.mock('./sprites.js', async importOriginal => {
  const real = await importOriginal<typeof import('./sprites.js')>();
  // Resolve a stand-in for every load so the staging logic runs without a DOM.
  const loadSprite = async (): Promise<SpriteImage> => ({ canvas: {} as HTMLCanvasElement, w: 1, h: 1 });
  return { ...real, loadSprite };
});

const { ensureTourArt, openingArt, stagedArt, titleArt, tourArt } = await import('./tour-art.js');

const TOURS: readonly TourId[] = ['grand', 'world', 'stone'];

/** Every sprite name a tour's data can ask for while riding it. */
function referencedSprites(tour: TourId): Set<string> {
  setActiveTour(tour);
  const names = new Set<string>();
  for (let m = 0; m <= finishDistanceM() + 2000; m += 50) {
    for (const car of rosterAt(m)) names.add(car);
    const kit = sceneryKitAt(m);
    for (const tree of kit.trees) names.add(tree);
    names.add(kit.accent);
    names.add(kit.landmark);
    const tod = timeOfDayAt(m);
    names.add(`horizon-${tod.a}`);
    names.add(`horizon-${tod.b}`);
  }
  return names;
}

describe('tour art sets', () => {
  afterEach(() => setActiveTour('grand'));

  it('covers every horizon a tour can draw, at any distance', () => {
    for (const tour of TOURS) {
      const set = new Set(tourArt(tour));
      setActiveTour(tour);
      for (let m = 0; m <= finishDistanceM() + 2000; m += 50) {
        const tod = timeOfDayAt(m);
        expect(set.has(`horizon-${tod.a}`), `${tour} @${m}m a`).toBe(true);
        expect(set.has(`horizon-${tod.b}`), `${tour} @${m}m b`).toBe(true);
      }
    }
  });

  it('loads every art-backed sprite a tour references (title gate plus the tour set)', () => {
    for (const tour of TOURS) {
      const loaded = new Set([...titleArt(), ...tourArt(tour)]);
      for (const name of referencedSprites(tour)) {
        // Names with no art file are code-drawn fallbacks, always available.
        if (name in ART_URLS) expect(loaded.has(name), `${tour}: ${name}`).toBe(true);
      }
    }
  });

  it('keeps staged art out of the title gate and every staged file real', () => {
    const gate = new Set(titleArt());
    for (const name of stagedArt()) {
      expect(gate.has(name), name).toBe(false);
      expect(name in ART_URLS, name).toBe(true);
    }
    expect(gate.size + stagedArt().size).toBe(Object.keys(ART_URLS).length);
  });

  it('stages every horizon, and only horizons', () => {
    const horizons = Object.keys(ART_URLS).filter(name => name.startsWith('horizon-'));
    expect([...stagedArt()].sort()).toEqual(horizons.sort());
  });

  it('opens each tour on horizons that belong to it', () => {
    for (const tour of TOURS) {
      const own = new Set(tourHorizons(tour));
      for (const b of openingHorizons(tour)) expect(own.has(b), `${tour} ${b}`).toBe(true);
      expect(openingArt(tour).length).toBeGreaterThan(0);
      setActiveTour(tour);
      const tod = timeOfDayAt(0);
      expect(new Set(openingArt(tour))).toEqual(new Set([`horizon-${tod.a}`, `horizon-${tod.b}`]));
    }
  });
});

describe('ensureTourArt', () => {
  it('waits for the opening horizons, then streams the rest in leg order', async () => {
    const store = new SpriteStore();
    const pending = ensureTourArt(store, 'grand', { streamRest: true });
    expect(pending).not.toBeNull();
    await pending;
    for (const name of openingArt('grand')) expect(store.has(name), name).toBe(true);
    await vi.waitFor(() => { for (const name of tourArt('grand')) expect(store.has(name), name).toBe(true); });
    expect(ensureTourArt(store, 'grand')).toBeNull(); // already resident: no gate
  });

  it('holds only the active tour: switching drops the previous tour horizons', async () => {
    const store = new SpriteStore();
    await ensureTourArt(store, 'grand', { streamRest: true });
    await vi.waitFor(() => { for (const name of tourArt('grand')) expect(store.has(name)).toBe(true); });
    await ensureTourArt(store, 'stone', { streamRest: true });
    await vi.waitFor(() => { for (const name of tourArt('stone')) expect(store.has(name)).toBe(true); });
    const held = [...stagedArt()].filter(name => store.has(name)).sort();
    expect(held).toEqual([...tourArt('stone')].sort());
  });

  it('does not pin a late arrival from a tour the player has left', async () => {
    const store = new SpriteStore();
    const first = ensureTourArt(store, 'grand'); // opening pair in flight
    await ensureTourArt(store, 'world');
    await first;
    const held = [...stagedArt()].filter(name => store.has(name));
    expect(held.every(name => tourArt('world').includes(name))).toBe(true);
  });
});
