// Draws DNI on the Vespa, seen from behind, near the bottom of the screen.
//
// Uses the AI lean frames (they have the nice weight-shift the flat rotation
// lacked). `hero-lean-left.png` visually leans to the viewer's RIGHT, so it is
// drawn as-is for a right lean and MIRRORED for a left lean — that fixes the
// direction and keeps left/right symmetric. Frames are normalised to a common
// on-screen HEIGHT and a bottom-centre anchor so they never jump size between
// poses. A subtle blur over the wheel gives the impression of it spinning.

import type { SpriteStore, SpriteImage } from './sprites.js';
import { clamp } from './util.js';

export interface RiderVisual {
  x: number; // screen x of the wheel contact
  y: number; // screen y of the wheel contact
  size: number; // target rider HEIGHT in px (frames normalise to this)
  lean: number; // -1..1 (negative = leaning left)
  yaw: number; // slip angle in radians (+ = nose swung right) — the powerslide
  bob: number; // small vertical bob in px
  wipeout: number; // 0..1 crash animation progress (0 = riding)
  spin: number; // accumulated wheel rotation in radians
  speed: number; // 0..1, drives motion blur + wind
  time: number; // seconds, drives the hair flutter
  /** Sprite family prefix: 'hero' (default) or 'caveman' (the prehistoric tour).
   *  A set with a native `-lean-right` frame uses it un-mirrored — mirroring
   *  the two-seater log car would swap the caveman and the monkey. */
  set?: string;
}

/** On-screen height of the bike. Shared with the smoke, which scales off it. */
export function riderSize(width: number, height: number): number {
  return Math.min(height * 0.3, width * 0.32);
}

const LEAN_DEADZONE = 0.12;
const HAIR_FRAC = 0.42; // top fraction of the sprite the wind flutters (hair)
const WIND_SLICES = 22;
// A yawed bike seen from BEHIND does not rotate in-plane — it swings its tail
// out. With one rear-view sprite the honest cheap read is a shear: pin the
// contact patch and lay the machine over against the slide, so the bike is
// visibly crossed up under a rider who is still hanging off the inside.
const YAW_SHEAR = 0.42;
const YAW_TILT = 0.2;
const LEAN_BANK = 0.11; // hero: rotation added on top of the art's weight-shift
const CART_BANK = 0.2; // cart: no hang-off art, so it leans purely by rotation

export function drawRider(ctx: CanvasRenderingContext2D, store: SpriteStore, v: RiderVisual): void {
  const cx = v.x;
  const baseY = v.y - v.bob;

  // Soft contact shadow.
  ctx.save();
  ctx.globalAlpha = 0.26;
  ctx.fillStyle = '#0a1a10';
  ctx.beginPath();
  ctx.ellipse(cx, baseY - 2, v.size * 0.26, v.size * 0.06, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  const set = v.set ?? 'hero';
  // The hero is a single, symmetric rider: one '-lean' frame can be MIRRORED to
  // lean the other way. The prehistoric log car cannot — it seats the caveman on
  // the LEFT and the monkey on the RIGHT, so mirroring teleports the pair into
  // each other's seats (a jarring left/right swap). Nor can it flip between two
  // whole frames to animate the wheels: its '-straight' and '-straight-2' are
  // different renders, so alternating them flickered the ENTIRE vehicle. So an
  // asymmetric set rides ONE upright frame and leans purely by the code bank
  // below. The upright frame prefers '-straight-2', whose painterly style
  // matches the lean/wipeout art — '-straight' is an earlier, mismatched render
  // kept only as a fallback.
  const mirrorable = set === 'hero';
  const leanFrame = set === 'hero' ? 'hero-lean-left' : `${set}-lean-right`;

  let sprite: SpriteImage | null;
  let mirror = false;
  let stagedWipeout = false;
  if (v.wipeout > 0) {
    // Multi-frame tumble where the set provides one (the log car): the ART
    // carries the crash animation, so the code rotation is eased right back —
    // decided by whether the set ships staged frames AT ALL, so the roll rate
    // never jumps mid-crash as the frames turn over. Frames turn over EARLY
    // (0.28 / 0.6) — the impact should read as a flipbook, not a slideshow.
    stagedWipeout = store.get(`${set}-wipeout-2`) !== null;
    const wf = !stagedWipeout ? '' : v.wipeout < 0.28 ? '' : v.wipeout < 0.6 ? '-2' : '-3';
    sprite = (wf ? store.get(`${set}-wipeout${wf}`) : null) ?? store.get(`${set}-wipeout`) ?? store.get(`${set}-straight`);
  } else if (!mirrorable) {
    // Asymmetric two-seater: never mirror, never frame-swap. One stable frame —
    // the bank (applied below) supplies the lean and the occupants never move.
    sprite = store.get(`${set}-straight-2`) ?? store.get(`${set}-straight`);
  } else if (v.lean > LEAN_DEADZONE) {
    sprite = store.get(leanFrame) ?? store.get(`${set}-straight`);
  } else if (v.lean < -LEAN_DEADZONE) {
    sprite = store.get(leanFrame) ?? store.get(`${set}-straight`);
    mirror = true; // flip the visually-right canonical frame -> leans left
  } else {
    sprite = store.get(`${set}-straight`);
  }

  if (!sprite) {
    drawFallbackRider(ctx, cx, baseY, v.size, v.lean, v.wipeout);
    return;
  }

  // Normalise to a common HEIGHT so poses of differing aspect don't resize.
  const h = v.size;
  const w = h * (sprite.w / sprite.h);
  ctx.save();
  ctx.translate(cx, baseY);
  ctx.imageSmoothingEnabled = true;
  if (v.wipeout > 0) {
    // A staged (multi-frame) wipeout animates in the art — only a gentle
    // residual roll on top, plus a decaying impact BOUNCE so the sprite is in
    // motion even while a frame is held; single-frame sets keep the full spin.
    if (stagedWipeout) {
      ctx.rotate(v.wipeout * Math.PI * 0.3);
      ctx.translate(0, -Math.abs(Math.sin(v.wipeout * Math.PI * 3)) * (1 - v.wipeout) * h * 0.1);
    } else {
      ctx.rotate(v.wipeout * Math.PI * 1.6);
    }
    if (mirror) ctx.scale(-1, 1);
    ctx.drawImage(sprite.canvas, -w / 2, -h, w, h);
  } else {
    // Continuous bank on top of the discrete lean frames — the rotation is
    // applied OUTSIDE the mirror flip, so it stays screen-oriented and pivots
    // at the wheel contact. Analogue lean makes the frames read as weight-shift.
    // The log car has no hang-off art, so it banks HARDER: the tilt is its only
    // lean tell (CART_BANK vs LEAN_BANK).
    ctx.rotate(clamp(v.lean, -1, 1) * (mirrorable ? LEAN_BANK : CART_BANK) + v.yaw * YAW_TILT);
    // Crossed up: shear the machine over against the slide. The contact patch is
    // the origin here, so the wheels stay planted and only the body lays over.
    if (v.yaw !== 0) ctx.transform(1, 0, v.yaw * YAW_SHEAR, 1, 0, 0);
    if (mirror) ctx.scale(-1, 1);
    drawWindSprite(ctx, sprite, w, h, v.time, 2 + v.speed * 11);
  }
  ctx.restore();

  // The hero's single rear wheel gets the centred wheel-blur. The cart's stone
  // wheels are left as the art draws them (they can't be cleanly spun in code).
  if (v.wipeout === 0 && mirrorable) drawWheelBlur(ctx, cx, baseY, w, v.spin, v.speed);
}

/**
 * Draws the sprite in horizontal slices, shearing the TOP slices sideways so
 * the hair flutters in the wind. The shear falls off below HAIR_FRAC so the
 * body and scooter stay put; amplitude scales with speed.
 */
function drawWindSprite(ctx: CanvasRenderingContext2D, sprite: SpriteImage, w: number, h: number, time: number, wind: number): void {
  const n = WIND_SLICES;
  const srcSlice = sprite.h / n;
  for (let i = 0; i < n; i += 1) {
    const ny = i / n;
    const hair = ny < HAIR_FRAC ? Math.pow(1 - ny / HAIR_FRAC, 1.4) : 0;
    const xoff = wind * hair * Math.sin(time * 5 + ny * 5.5);
    ctx.drawImage(
      sprite.canvas,
      0,
      i * srcSlice,
      sprite.w,
      srcSlice + 1,
      -w / 2 + xoff,
      -h + ny * h,
      w,
      h / n + 1,
    );
  }
}

/**
 * Subtle spinning-wheel impression: a couple of faint horizontal light streaks
 * over the rear wheel whose vertical position cycles with `spin`, plus a light
 * ground-blur at speed. Deliberately low-key so it never reads as a stuck-on
 * hub — just enough to say "the wheel is turning".
 */
function drawWheelBlur(ctx: CanvasRenderingContext2D, cx: number, baseY: number, spriteW: number, spin: number, speed: number): void {
  if (speed < 0.06) return;
  const wheelW = spriteW * 0.16;
  const wheelH = spriteW * 0.2;
  const top = baseY - wheelH;
  ctx.save();
  ctx.beginPath();
  ctx.rect(cx - wheelW / 2, top, wheelW, wheelH);
  ctx.clip();
  ctx.strokeStyle = `rgba(210, 216, 226, ${0.1 + speed * 0.28})`;
  ctx.lineWidth = Math.max(1, wheelH * 0.05);
  ctx.lineCap = 'round';
  const streaks = 3;
  for (let i = 0; i < streaks; i += 1) {
    // cycle each streak's vertical position with the wheel rotation
    const phase = (spin * 0.5 + i / streaks) % 1;
    const y = top + phase * wheelH;
    ctx.beginPath();
    ctx.moveTo(cx - wheelW * 0.42, y);
    ctx.lineTo(cx + wheelW * 0.42, y);
    ctx.stroke();
  }
  ctx.restore();
}

/** Minimal code-drawn DNI + Vespa so the game renders with no art. */
function drawFallbackRider(ctx: CanvasRenderingContext2D, cx: number, baseY: number, size: number, lean: number, wipeout: number): void {
  const s = size / 260;
  ctx.save();
  ctx.translate(cx, baseY);
  if (wipeout > 0) ctx.rotate(wipeout * Math.PI * 1.5);
  ctx.rotate(clamp(lean, -1, 1) * 0.14);
  ctx.scale(s, s);
  ctx.translate(-110, -260);
  ctx.fillStyle = '#8fdcc0';
  ctx.fillRect(60, 150, 100, 90);
  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(96, 236, 28, 24);
  ctx.fillStyle = '#14181d';
  ctx.beginPath();
  ctx.moveTo(72, 150);
  ctx.quadraticCurveTo(110, 70, 148, 150);
  ctx.lineTo(148, 160);
  ctx.lineTo(72, 160);
  ctx.fill();
  ctx.fillStyle = '#a5561f';
  ctx.beginPath();
  ctx.ellipse(110, 78, 34, 44, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}
