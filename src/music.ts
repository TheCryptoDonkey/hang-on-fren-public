// Streams a looping music bed through the audio engine's music bus, so the
// existing SFX ducking (pulseMusicDuck) applies automatically. Uses an
// <audio> element source rather than decoding the whole file up front.

import { getMusicDestination, getMusicGain } from './audio.js';

let audioEl: HTMLAudioElement | null = null;
let srcNode: MediaElementAudioSourceNode | null = null;
let wired = false;

export function initMusic(url: string): void {
  if (audioEl) return;
  audioEl = new Audio(url);
  audioEl.loop = true;
  audioEl.preload = 'auto';
  audioEl.crossOrigin = 'anonymous';
  audioEl.volume = 1; // level is controlled by the music bus gain
}

/** Route the element into the music bus and start playback (idempotent). */
export function startMusic(): void {
  if (!audioEl) return;
  const dest = getMusicDestination();
  const ctx = (dest as unknown as { context: AudioContext }).context;
  if (!wired) {
    try {
      srcNode = ctx.createMediaElementSource(audioEl);
      srcNode.connect(dest);
      wired = true;
    } catch {
      // Some browsers throw if the element was already wired; ignore.
    }
  }
  // Ensure the bus carries the configured music level.
  if (dest instanceof GainNode && dest.gain.value < 0.01) dest.gain.value = getMusicGain();
  void audioEl.play().catch(() => undefined);
}

export function isMusicPlaying(): boolean {
  return !!audioEl && !audioEl.paused;
}
