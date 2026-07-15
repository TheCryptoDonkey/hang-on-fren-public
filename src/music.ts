// Streams a looping music bed through the audio engine's music bus, so the
// existing SFX ducking (pulseMusicDuck) applies automatically. Uses <audio>
// element sources rather than decoding whole files up front. Several tracks
// can be registered (the title/journey theme plus per-region beds — Old Prague
// has its own); startMusic switches between them, restarting a bed from the
// top whenever it takes over.

import { getMusicDestination, getMusicGain } from './audio.js';

let defaultUrl = '';
const tracks = new Map<string, HTMLAudioElement>();
const wired = new WeakSet<HTMLAudioElement>();
const warmed = new WeakSet<HTMLAudioElement>();
let currentUrl: string | null = null;

// Beds are registered with preload='none' so merely creating a track costs no
// bandwidth. `warm` upgrades a specific bed to full buffering on demand — this
// is what keeps ~13MB of region music off the initial page load; only the
// title theme and the beds a run actually needs are ever fetched.
function ensureTrack(url: string): HTMLAudioElement {
  let el = tracks.get(url);
  if (!el) {
    el = new Audio(url);
    el.loop = true;
    el.preload = 'none';
    el.crossOrigin = 'anonymous';
    el.volume = 1; // level is controlled by the music bus gain
    tracks.set(url, el);
  }
  return el;
}

/** Begin buffering a bed's audio data (idempotent — load() only fires once). */
function warm(el: HTMLAudioElement): void {
  if (warmed.has(el)) return;
  warmed.add(el);
  el.preload = 'auto';
  el.load();
}

/** Register the default (title/journey) music bed and start buffering it —
 *  it plays on the first user gesture, so it should be ready by then. */
export function initMusic(url: string): void {
  defaultUrl = url;
  warm(ensureTrack(url));
}

/** Register an extra music bed and buffer it ahead of when it is first needed. */
export function preloadMusic(url: string): void {
  warm(ensureTrack(url));
}

/** Route `url` (default: the initMusic bed) into the music bus and start it,
 *  stopping whichever other bed was playing. Idempotent per track. */
export function startMusic(url = defaultUrl): void {
  if (!url) return;
  const el = ensureTrack(url);
  // play() fetches on demand, so don't call load() here (it would restart an
  // already-buffering bed) — just mark it warmed and let preload catch up.
  warmed.add(el);
  el.preload = 'auto';
  const dest = getMusicDestination();
  const ctx = (dest as unknown as { context: AudioContext }).context;
  if (!wired.has(el)) {
    try {
      ctx.createMediaElementSource(el).connect(dest);
      wired.add(el);
    } catch {
      // Some browsers throw if the element was already wired; ignore.
    }
  }
  if (currentUrl && currentUrl !== url) {
    const prev = tracks.get(currentUrl);
    if (prev) {
      prev.pause();
      prev.currentTime = 0; // a bed re-entered later starts from the top
    }
  }
  currentUrl = url;
  // Ensure the bus carries the configured music level.
  if (dest instanceof GainNode && dest.gain.value < 0.01) dest.gain.value = getMusicGain();
  void el.play().catch(() => undefined);
}

export function currentMusicUrl(): string | null {
  return currentUrl;
}

export function isMusicPlaying(): boolean {
  const el = currentUrl ? tracks.get(currentUrl) : null;
  return !!el && !el.paused;
}
