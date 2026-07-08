// Small maths + RNG helpers shared across the game. Kept dependency-free and
// pure so the physics, spawning and scoring logic stay unit-testable.

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Ease value `a`->`b` toward b by `rate` per second, framerate-independent. */
export function approach(a: number, b: number, rate: number, dt: number): number {
  const t = 1 - Math.exp(-rate * dt);
  return a + (b - a) * t;
}

export function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

/** Wrap `value` into [0, limit). */
export function wrap(value: number, limit: number): number {
  let v = value % limit;
  if (v < 0) v += limit;
  return v;
}

/** Deterministic mulberry32 PRNG — same seed always yields the same stream. */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return function rng(): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randRange(rng: () => number, min: number, max: number): number {
  return min + (max - min) * rng();
}

export function pick<T>(rng: () => number, items: readonly T[]): T {
  return items[Math.floor(rng() * items.length) % items.length];
}

export function formatTime(seconds: number): string {
  const s = Math.max(0, seconds);
  const whole = Math.floor(s);
  const frac = Math.floor((s - whole) * 100);
  return `${whole}.${frac.toString().padStart(2, '0')}`;
}
