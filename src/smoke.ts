// Tyre smoke — the thing that actually sells a powerslide.
//
// This is a SCREEN-SPACE effect, deliberately. Laying marks on the tarmac would
// be the obvious approach and it does not work with this camera: the eye sits
// only RIDER_FWD (~1000 world units) behind the bike, which is drawn at 96% of
// screen height, so a mark laid under the wheels is visible for about a tenth of
// a second in the bottom sliver of the frame before the camera swallows it.
// Smoke, on the other hand, billows UP and OUT from the contact patch into the
// middle of the screen, where there is room for it to be seen. So the plume is
// the effect, and there are no skid marks.

export interface Smoke {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number; // seconds remaining
  ttl: number;
  radius: number;
  growth: number; // px/sec the puff swells as it disperses
  tint: number; // 0 = clean white smoke … 1 = dirty grass/dust brown
}

const MAX_PUFFS = 90;

/**
 * Spawn a puff at the rear contact patch. `dir` is the way the slide is
 * pointing (-1 left / +1 right): smoke is thrown OPPOSITE the slide and back
 * down the road, which is what gives a drift its sense of direction.
 * `dirty` tints it toward dust for an off-road slide.
 */
export function spawnSmoke(
  list: Smoke[],
  x: number,
  y: number,
  dir: number,
  intensity: number,
  scale: number,
  dirty = false,
): void {
  if (list.length >= MAX_PUFFS) return;
  const spread = (Math.random() - 0.5) * 0.6;
  list.push({
    x: x + (Math.random() - 0.5) * scale * 0.12,
    y: y - Math.random() * scale * 0.04,
    // Thrown out AGAINST the slide: the bike goes right, the smoke is left behind
    // to the left, which is what gives a plume its sense of direction.
    vx: (-dir * (0.5 + Math.random() * 0.7) + spread) * scale * (0.7 + intensity),
    // …and UP. This is a screen-space effect and the contact patch is already at
    // 96% of screen height, so a puff with any downward velocity is off the bottom
    // of the frame before it has faded in — which is exactly what the first cut
    // did, and why the drift barely appeared to smoke at all. Real tyre smoke
    // billows upward behind the machine anyway; here it also happens to be the
    // only direction with any screen left to billow into.
    vy: -(0.3 + Math.random() * 0.55) * scale * 0.55,
    life: 0.45 + Math.random() * 0.45,
    ttl: 0.9,
    radius: scale * (0.06 + Math.random() * 0.05),
    // Grow, but not much: a puff that swells to a couple of hundred pixels spreads
    // its alpha into a faint wash and the plume reads as a smudge on the lens.
    // Small, dense, and MANY is what looks like smoke.
    growth: scale * (0.26 + Math.random() * 0.24),
    tint: dirty ? 0.6 + Math.random() * 0.4 : Math.random() * 0.16,
  });
}

export function updateSmoke(list: Smoke[], dt: number): void {
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const s = list[i];
    s.life -= dt;
    if (s.life <= 0) {
      list.splice(i, 1);
      continue;
    }
    s.x += s.vx * dt;
    s.y += s.vy * dt;
    s.vx *= 1 - dt * 1.5; // air drag — the plume stalls and hangs
    s.vy *= 1 - dt * 0.7; // …but it keeps climbing; smoke is buoyant
    s.radius += s.growth * dt;
  }
}

/** Soft radial puffs. Drawn under the rider so the plume comes out from behind it. */
export function drawSmoke(ctx: CanvasRenderingContext2D, list: Smoke[]): void {
  if (!list.length) return;
  ctx.save();
  for (const s of list) {
    const t = Math.max(0, s.life / s.ttl);
    // Fade in fast, hang, then dissipate — a puff that pops in at full opacity
    // reads as a decal rather than smoke.
    const alpha = Math.min(1, (1 - t) * 6) * t * 0.8;
    if (alpha <= 0.01) continue;
    const r = Math.max(1, s.radius);
    const grey = Math.round(232 - s.tint * 76);
    const rgb = `${grey},${Math.round(grey - s.tint * 24)},${Math.round(grey - s.tint * 62)}`;
    const g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, r);
    // A solid-ish core with the falloff pushed out to the rim. A pure 1→0 ramp
    // gives every puff a soft edge that never accumulates into anything: twenty
    // of them overlapping still read as haze rather than as smoke.
    g.addColorStop(0, `rgba(${rgb},${alpha})`);
    g.addColorStop(0.55, `rgba(${rgb},${alpha * 0.72})`);
    g.addColorStop(1, `rgba(${rgb},0)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}
