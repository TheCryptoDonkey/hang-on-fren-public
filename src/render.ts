// Renders the pseudo-3D scene: sky/sea/hills parallax, the projected road with
// distance fog, roadside scenery and dynamic entities (roses + traffic) with
// hill occlusion, then the rider on top. Pure drawing over already-updated
// state — all physics lives in road.ts / world.ts.

import { ROAD, RIDER_SCREEN_FRAC, project, findSegment, yawPan, riderScreenX } from './road.js';
import type { Track, Player, Segment } from './road.js';
import type { World } from './world.js';
import { signedForward } from './world.js';
import type { SpriteStore, SpriteImage } from './sprites.js';
import {
  DEFAULT_PALETTE, DEFAULT_TERRAIN, resolveScenerySprite,
  type GroundKind, type Palette, type SceneryKit, type SideKind, type Terrain, type TimeOfDay,
} from './stages.js';
import { spriteWorldWidth } from './geometry.js';
import { drawRider, riderSize } from './rider.js';
import type { Smoke } from './smoke.js';
import { drawSmoke } from './smoke.js';
import { clamp, lerp, wrap } from './util.js';

/**
 * How far outside the viewport the full-width fills (sky, grass, fog) are drawn.
 * The whole scene is ROLLED about the horizon to bank into corners, which sweeps
 * the canvas corners in from off-screen — without the bleed you would see bare
 * canvas wedges at the edges of every bend.
 */
const ROLL_BLEED = 0.28;

// Pickup kind → sprite id (kinds live in world.ts; art in sprites.ts).
const PICKUP_SPRITE: Record<string, string> = {
  petrol: 'pickup-petrol',
  rose: 'rose',
  cake: 'pickup-cake',
  wholecake: 'pickup-wholecake',
  meme: 'pickup-meme',
  ath: 'pickup-ath',
  timelock: 'pickup-timelock',
  fiatnam: 'pickup-fiatnam',
  fourtwenty: 'pickup-fourtwenty',
  shield: 'pickup-shield',
  beer: 'pickup-beer',
  shroom: 'pickup-shroom',
};

// Sprite widths (fraction of the full road width) live in geometry.ts — the
// single source of truth shared with collision, so the hitbox always matches the
// drawing.

// ---- colour helpers (local so render stays self-contained) -----------------
function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
function rgba(hex: string, a: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}
function mix(a: string, b: string, t: number): string {
  const [r1, g1, b1] = hexToRgb(a);
  const [r2, g2, b2] = hexToRgb(b);
  const c = (x: number, y: number): number => Math.round(x + (y - x) * t);
  return `rgb(${c(r1, r2)},${c(g1, g2)},${c(b1, b2)})`;
}
// Deterministic 0..1 hash (no per-frame RNG → the coastline never twinkles).
function hash(n: number): number {
  const x = Math.sin(n * 127.1 + 11.7) * 43758.5453;
  return x - Math.floor(x);
}

function rumbleWidth(projectedW: number): number {
  return projectedW / Math.max(6, ROAD.lanes * 2);
}
function laneMarkerWidth(projectedW: number): number {
  return projectedW / (ROAD.lanes * 12);
}

const CLOUDS = 11;
/**
 * Clouds drifting overhead. The painted backdrops carry gorgeous weather, but a
 * painted sky is a STILL sky — nothing up there moves and the eye clocks it. So
 * this is a light layer of soft wisps on their own slow drift, parallaxing with
 * the curve, fading into the haze toward the horizon so they never fight the
 * backdrop's own clouds. They thin out at night (`palette.star`) and vanish
 * under a tunnel roof (`cover`), so the neon city keeps its stars and a bore
 * keeps its ceiling. Each puff is a soft radial gradient — no hard edges to
 * accumulate into cotton balls, and no nested colour strings to go NaN.
 */
function drawClouds(
  ctx: CanvasRenderingContext2D,
  w: number,
  horizon: number,
  drift: number,
  palette: Palette,
  time: number,
  cover: number,
): void {
  const night = clamp(palette.star, 0, 1);
  const alpha = (1 - night * 0.72) * (1 - clamp(cover, 0, 1)) * 0.5;
  if (alpha <= 0.02 || horizon <= 0) return;

  const [hr, hg, hb] = hexToRgb(palette.skyHorizon);
  const cr = Math.round(255 + (hr - 255) * 0.22);
  const cg = Math.round(255 + (hg - 255) * 0.22);
  const cb = Math.round(255 + (hb - 255) * 0.22);
  const rgb = `${cr},${cg},${cb}`;

  const span = w * 1.6;
  ctx.save();
  ctx.beginPath();
  ctx.rect(-w * ROLL_BLEED, -horizon * ROLL_BLEED, w * (1 + 2 * ROLL_BLEED), horizon * (1 + ROLL_BLEED));
  ctx.clip();
  for (let i = 0; i < CLOUDS; i += 1) {
    const depth = 0.4 + hash(i * 4.1) * 0.6; // high clouds bigger, drift faster
    const along = time * (3 + depth * 11) + hash(i * 9.7) * span;
    const cx = wrap(along - drift * depth * 0.5, span) - (span - w) / 2;
    const cy = horizon * (0.05 + hash(i * 2.3 + 3) * 0.5);
    // Fade toward the horizon so they melt into the haze, not stop at a line.
    const near = clamp(1 - cy / (horizon * 0.9), 0, 1);
    const a = alpha * (0.4 + 0.5 * depth) * (0.2 + 0.8 * near);
    if (a <= 0.01) continue;
    const cw = w * (0.09 + depth * 0.14);
    for (let k = 0; k < 3; k += 1) {
      const lx = cx + (k - 1) * cw * 0.42;
      const ly = cy - hash(i * 13 + k) * cw * 0.12;
      const lr = cw * (0.34 + hash(i * 17 + k * 3) * 0.18);
      const g = ctx.createRadialGradient(lx, ly, 0, lx, ly, lr);
      g.addColorStop(0, `rgba(${rgb},${a})`);
      g.addColorStop(1, `rgba(${rgb},0)`);
      ctx.fillStyle = g;
      ctx.fillRect(lx - lr, ly - lr * 0.72, lr * 2, lr * 1.44);
    }
  }
  ctx.restore();
}

function polygon(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, x3: number, y3: number, x4: number, y4: number, color: string): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.lineTo(x3, y3);
  ctx.lineTo(x4, y4);
  ctx.closePath();
  ctx.fill();
}

// The sea-meets-sky horizon sits at roughly this fraction down each generated
// backdrop; we anchor that line to the road's horizon.
const BACKDROP_HORIZON_FRAC = 0.55;

/**
 * Draw the gpt-image Amalfi horizon: crossfade the two time-of-day backdrops for
 * the current distance and scroll them horizontally for parallax, anchoring each
 * image's sea-horizon to the road horizon. Returns false (so the caller can fall
 * back to the code-drawn seascape) if the backdrop art isn't available.
 */
function drawHorizonArt(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  horizon: number,
  curveShift: number,
  xPan: number,
  store: SpriteStore,
  tod: TimeOfDay | undefined,
  palette: Palette,
): boolean {
  const a = store.get(`horizon-${tod?.a ?? 'riviera'}`);
  const b = store.get(`horizon-${tod?.b ?? 'riviera'}`);
  if (!a || !b) return false;

  const draw = (img: SpriteImage, alpha: number): void => {
    if (alpha <= 0) return;
    // Cover the width with generous headroom: the backdrop has to survive both
    // the curve parallax AND a full camera-yaw pan without showing an edge.
    const scale = (w / img.w) * 1.5;
    const dw = img.w * scale;
    const dh = img.h * scale;
    const margin = (dw - w) / 2;
    // The curve parallax is an artistic drift (half strength, opposed); the yaw
    // pan is geometry and must land at FULL strength, exactly as it does on the
    // road — otherwise the horizon slides against the tarmac through a corner.
    const dx = -margin + clamp(-curveShift * 0.5 + xPan, -margin, margin);
    const dy = horizon - BACKDROP_HORIZON_FRAC * dh; // align sea-horizon to road horizon
    ctx.globalAlpha = alpha;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(img.canvas, dx, dy, dw, dh);
  };
  // Sky fill above the backdrop top, in case the road horizon sits low and the
  // scaled image doesn't quite reach y=0. Bled well past the frame so the bank
  // never rotates bare canvas into the top corners.
  ctx.fillStyle = palette.skyTop;
  ctx.fillRect(-w * ROLL_BLEED, -h * ROLL_BLEED, w * (1 + 2 * ROLL_BLEED), Math.max(0, horizon) + h * ROLL_BLEED);
  draw(a, 1);
  draw(b, tod?.t ?? 0);
  ctx.globalAlpha = 1;
  return true;
}


/**
 * Code-drawn fallback seascape (used only if the gpt-image backdrops fail to
 * load): sky, sun/moon with a glittering reflection, a sea band, hazy coastal
 * mountains and a pastel cliff-town — parallax-shifted and palette-tinted.
 */
function drawBackground(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  horizon: number,
  curveShift: number,
  xPan: number,
  palette: Palette,
  time: number,
): void {
  const night = clamp(palette.star, 0, 1); // 0 = bright day … 1 = full night
  const seaTop = horizon - h * 0.13; // the shoreline: sea below it, mountains above
  const bleedX = -w * ROLL_BLEED;
  const bleedW = w * (1 + 2 * ROLL_BLEED);

  // --- sky -------------------------------------------------------------------
  const sky = ctx.createLinearGradient(0, 0, 0, seaTop);
  sky.addColorStop(0, palette.skyTop);
  sky.addColorStop(1, palette.skyHorizon);
  ctx.fillStyle = sky;
  ctx.fillRect(bleedX, -h * ROLL_BLEED, bleedW, seaTop + 2 + h * ROLL_BLEED);

  // stars — fixed scatter, brightening with night
  if (night > 0.02) {
    for (let i = 0; i < 80; i += 1) {
      const sx = hash(i * 1.7) * w;
      const sy = hash(i * 3.9 + 5) * seaTop * 0.85;
      const tw = 0.55 + 0.45 * Math.sin(time * 1.5 + i); // gentle twinkle
      ctx.fillStyle = `rgba(255,255,255,${night * (i % 4 === 0 ? 0.9 : 0.5) * tw})`;
      const s = i % 5 === 0 ? 2 : 1;
      ctx.fillRect(sx, sy, s, s);
    }
  }

  // --- sun / moon ------------------------------------------------------------
  const sunX = w * 0.68 - curveShift * 0.45 + xPan;
  const sunY = seaTop - h * 0.16;
  const sunR = h * (night > 0.5 ? 0.055 : 0.085);
  ctx.save();
  // soft outer glow / haze halo
  const halo = ctx.createRadialGradient(sunX, sunY, sunR * 0.4, sunX, sunY, sunR * 4);
  halo.addColorStop(0, rgba(palette.sun, night > 0.5 ? 0.5 : 0.8));
  halo.addColorStop(1, rgba(palette.sun, 0));
  ctx.fillStyle = halo;
  ctx.fillRect(sunX - sunR * 4, sunY - sunR * 4, sunR * 8, sunR * 8);
  ctx.fillStyle = palette.sun;
  ctx.globalAlpha = 0.97;
  ctx.beginPath();
  ctx.arc(sunX, sunY, sunR, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // --- distant mountain ranges (far, hazy → nearer, defined) -----------------
  // A big massif on the left tapering to open sea on the right, echoing the
  // title art. Two layers with different haze + parallax give real depth.
  const drawRange = (
    amp: number,
    freq: number,
    seed: number,
    colour: string,
    haze: number,
    parallax: number,
  ): void => {
    const shift = curveShift * parallax + xPan;
    ctx.fillStyle = mix(colour, palette.skyHorizon, haze);
    ctx.beginPath();
    ctx.moveTo(0, seaTop); // mountains stand on the shoreline (seaTop)
    const N = 48;
    for (let i = 0; i <= N; i += 1) {
      const t = i / N;
      const x = t * w + shift;
      // left-weighted envelope: mountains high on the left, sinking to the right
      const envelope = Math.pow(1 - t, 1.3) * 0.8 + 0.2;
      const ridge = (Math.sin(t * freq + seed) * 0.5 + 0.5) * 0.6
        + (Math.sin(t * freq * 2.3 + seed * 1.7) * 0.5 + 0.5) * 0.3
        + hash(Math.floor(t * 24) + seed) * 0.1;
      const y = seaTop - ridge * amp * envelope;
      ctx.lineTo((x % (w + 200)), y);
    }
    ctx.lineTo(w, seaTop);
    ctx.closePath();
    ctx.fill();
  };
  drawRange(h * 0.26, 5.5, 2.0, palette.hillsFar, 0.5, 0.18);
  drawRange(h * 0.19, 8.0, 7.3, palette.hillsFar, 0.24, 0.3);

  // --- sea band --------------------------------------------------------------
  // Keep it reading as water even at sunset: bias toward the sea hue, only a
  // little sky haze at the far shoreline.
  const sea = ctx.createLinearGradient(0, seaTop, 0, horizon);
  sea.addColorStop(0, mix(palette.sea, palette.skyHorizon, 0.4));
  sea.addColorStop(0.25, mix(palette.sea, palette.skyHorizon, 0.12));
  sea.addColorStop(1, palette.sea);
  ctx.fillStyle = sea;
  ctx.fillRect(bleedX, seaTop, bleedW, horizon - seaTop + 2);

  // sun/moon glitter: broken shimmer streaks widening down the sun's reflection
  // path — reads as scattered reflected light rather than a solid column.
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, seaTop, w, horizon - seaTop);
  ctx.clip();
  const rows = 20;
  const rowH = Math.max(1, (horizon - seaTop) / rows);
  for (let i = 0; i < rows; i += 1) {
    const yy = seaTop + i * rowH;
    const spread = sunR * (0.5 + i * 0.28); // path fans out toward the shore
    const flick = 0.3 + 0.7 * Math.abs(Math.sin(time * 2.4 + i * 1.7));
    const baseA = (night > 0.5 ? 0.3 : 0.55) * flick * (1 - i / (rows + 4));
    // 1-3 short dashes scattered across the reflection width
    const dashes = 1 + (i % 3);
    for (let d = 0; d < dashes; d += 1) {
      const off = (hash(i * 3 + d * 7) - 0.5) * spread * 2;
      const dw = spread * (0.18 + hash(i * 5 + d) * 0.4);
      ctx.fillStyle = rgba(palette.sun, baseA);
      ctx.fillRect(sunX + off - dw / 2, yy, dw, Math.max(1, rowH * 0.7));
    }
  }
  ctx.restore();

  // --- coastal cliff-town on the left promontory -----------------------------
  drawCoastTown(ctx, w, h, seaTop, curveShift * 0.32 + xPan, palette, night);

  // thin bright horizon line where sea meets the shore haze
  ctx.fillStyle = rgba(palette.fog, 0.5);
  ctx.fillRect(bleedX, horizon - 1, bleedW, 2);
}

/** Pastel Amalfi town stacked up a headland on the left, windows lit at dusk. */
function drawCoastTown(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  seaTop: number,
  shift: number,
  palette: Palette,
  night: number,
): void {
  const pastels = ['#f4d9b0', '#e8b89a', '#e6a4a0', '#d9c27e', '#efe3c4', '#c98f7a'];
  // Positano-style cascade down the LEFT headland only: houses highest at the
  // back-left, tumbling down to the waterline (seaTop) at the right of the town.
  const baseX = w * 0.012 + shift;
  const townW = w * 0.17;
  const hillTop = seaTop - h * 0.17; // top of the inhabited slope
  const count = 34;
  ctx.save();
  for (let i = 0; i < count; i += 1) {
    const t = hash(i * 2.3 + 1); // 0 = high/left … 1 = low/right (shoreline)
    const r2 = hash(i * 5.1 + 9);
    const tx = baseX + t * townW;
    // base sits on the slope: a straight-ish cascade with a little jitter
    const slopeY = lerp(hillTop, seaTop, Math.pow(t, 0.85)) + (r2 - 0.5) * h * 0.02;
    const bw = w * (0.011 + r2 * 0.017);
    const bh = h * (0.02 + hash(i * 7.7) * 0.04);
    const by = slopeY - bh;
    let colour = pastels[i % pastels.length];
    colour = mix(colour, palette.hillsNear, 0.2 + night * 0.5); // haze + dusk dimming
    ctx.fillStyle = colour;
    ctx.fillRect(tx, by, bw, bh);
    // terracotta roof cap
    ctx.fillStyle = mix('#c26b45', palette.hillsNear, night * 0.55);
    ctx.fillRect(tx - bw * 0.06, by, bw * 1.12, Math.max(1, bh * 0.16));
    // windows — small dots, warmly lit at dusk/night
    const cols = Math.max(1, Math.round(bw / (w * 0.0055)));
    const rows = Math.max(1, Math.round(bh / (h * 0.016)));
    for (let cx = 0; cx < cols; cx += 1) {
      for (let cy = 0; cy < rows; cy += 1) {
        const lit = night > 0.22 && hash(i * 31 + cx * 7 + cy * 3) > 0.45;
        ctx.fillStyle = lit ? rgba('#ffdf9a', 0.95) : rgba('#4a3a44', 0.3 + night * 0.25);
        ctx.fillRect(
          tx + (cx + 0.5) * (bw / cols) - bw * 0.05,
          by + bh * 0.24 + cy * (bh * 0.62 / rows),
          Math.max(1, bw * 0.1),
          Math.max(1, bh * 0.09),
        );
      }
    }
  }
  ctx.restore();
}

interface EntityDraw {
  sx: number; // screen x of the road point the sprite stands on
  sy: number; // screen y (road contact)
  scale: number;
  clip: number; // hill-occlusion y-clip from its segment
  offset: number;
  sprite: string;
  bobY: number;
  fwd: number;
}

export interface Scene {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  track: Track;
  player: Player;
  world: World;
  store: SpriteStore;
  time: number;
  wipeout: number;
  boost: number; // 0..1 turbo intensity
  sling?: number; // 0..1 slipstream slingshot intensity
  draft?: number; // 0..1 banked draft charge while tucked in a wake
  wobble?: number; // 0..1 beer intensity — drunken camera sway + double vision
  trip?: number; // 0..1 fly-agaric intensity — full psychedelic colour trip
  palette?: Palette; // time-of-day colours; defaults to bright day
  scenery?: SceneryKit; // per-stage roadside prop kit; resolves scenery slots
  timeOfDay?: TimeOfDay; // which gpt-image horizon backdrops to crossfade
  // ---- camera (main.ts owns the smoothing; see CAM in main) ----
  camYaw?: number; // radians the eye is turned INTO the corner / along the slide
  camRoll?: number; // radians the whole view banks
  camLag?: number; // road-offset units the eye trails the bike by
  smoke?: Smoke[]; // tyre-smoke puffs, drawn under the rider
  enclosure?: number; // 0..1 how deep under a tunnel/bridge the bike is
  terrain?: Terrain; // what the ground does either side of the verge (cliff/sea/drop)
}

// Offscreen frame snapshot reused by the trip kaleidoscope (no per-frame alloc).
let tripSnap: HTMLCanvasElement | null = null;

export function renderScene(scene: Scene): void {
  const { ctx, width, height, track, player, world, store } = scene;
  groundArt = store; // ground tiles pull their generated textures from here
  const palette = scene.palette ?? DEFAULT_PALETTE;
  const terrain = scene.terrain ?? DEFAULT_TERRAIN;
  const camYaw = scene.camYaw ?? 0;
  const camRoll = scene.camRoll ?? 0;
  const camLag = scene.camLag ?? 0;

  const baseSegment = findSegment(track, player.z);
  const basePercent = (player.z % ROAD.segmentLength) / ROAD.segmentLength;
  const playerY = lerp(baseSegment.p1.world.y, baseSegment.p2.world.y, basePercent);
  const cameraY = playerY + ROAD.cameraHeight;
  // The eye TRAILS the bike laterally, so a hard steer or a slide swings the bike
  // across the frame instead of pinning it dead-centre like a cardboard cut-out.
  const cameraX = (player.x - camLag) * ROAD.roadWidth;
  // A camera yaw is a pure horizontal pan at every depth (see yawPan in road.ts).
  const xPan = yawPan(camYaw, width);

  // Project the road, accumulating the curve offset (x, dx) like Hang-On.
  let x = 0;
  let dx = -(baseSegment.curve * basePercent);
  let maxY = height;
  const drawn: Segment[] = [];

  for (let n = 0; n < ROAD.drawDistance; n += 1) {
    const seg = track.segments[(baseSegment.index + n) % track.segments.length];
    const looped = seg.index < baseSegment.index;
    const camZ = player.z - (looped ? track.length : 0);
    project(seg.p1, cameraX - x, cameraY, camZ, width, height, ROAD.roadWidth, xPan);
    project(seg.p2, cameraX - x - dx, cameraY, camZ, width, height, ROAD.roadWidth, xPan);
    x += dx;
    dx += seg.curve;

    seg.clip = maxY;
    if (seg.p1.screen.y <= seg.p2.screen.y) continue; // facing away / degenerate
    if (seg.p2.screen.y >= maxY) continue; // occluded by nearer ground
    drawn.push(seg);
    maxY = seg.p2.screen.y;
  }

  // Off-road rumble + crash impact: shake the whole view (but not the HUD,
  // drawn later). The impact kick is hardest at the moment of the wipeout and
  // dies away as the spin animation plays out.
  const speedPct0 = player.speed / player.maxSpeed;
  const impact = scene.wipeout > 0 ? Math.pow(1 - scene.wipeout, 1.6) : 0;
  const shake = (player.offRoad ? 2 + speedPct0 * 8 : 0) + impact * 16;
  ctx.save();
  if (shake > 0) ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);

  // Beer wobble: the whole scene rolls, breathes and sways on slow sinusoids —
  // seasick rather than shaken (that's what the crash shake above is for).
  const wobble = scene.wobble ?? 0;
  if (wobble > 0) {
    const t = scene.time;
    ctx.translate(width / 2, height / 2);
    ctx.rotate((Math.sin(t * 1.8) * 0.028 + Math.sin(t * 0.9 + 1.3) * 0.014) * wobble);
    // Overscan so the roll/sway never exposes bare canvas at the screen edges.
    const overscan = 1 + 0.06 * wobble;
    const breathe = overscan * (1 + Math.sin(t * 1.3) * 0.02 * wobble);
    ctx.scale(breathe, overscan * (1 + Math.cos(t * 1.7) * 0.02 * wobble));
    ctx.translate(
      -width / 2 + Math.sin(t * 2.2) * width * 0.02 * wobble,
      -height / 2 + Math.cos(t * 1.5) * height * 0.014 * wobble,
    );
  }

  const horizon = clamp(drawn.length ? drawn[drawn.length - 1].p2.screen.y : height * 0.5, height * 0.18, height * 0.62);

  // BANK. The whole view rolls about the horizon, so the world tilts as the bike
  // leans — the single cheapest thing that stops a pseudo-3D road reading as a
  // flat scrolling texture. Everything below is drawn with ROLL_BLEED of
  // overscan so the rotated corners never expose bare canvas.
  if (camRoll !== 0) {
    ctx.translate(width / 2, horizon);
    ctx.rotate(camRoll);
    ctx.translate(-width / 2, -horizon);
  }

  // Primary path: the gpt-image horizon backdrops, crossfaded per region and
  // gently scrolled with the curve. The flat panorama IS the far world — no
  // detail planes over it (cardboard-cutout layers fought the 32-bit look).
  // Falls back to the code-drawn seascape only if the backdrop art isn't loaded.
  // The yaw pans the horizon by exactly as much as it pans the road, so the two
  // stay locked together through a corner.
  const horizonShift = x * 0.02 + player.x * width * 0.08;
  if (!drawHorizonArt(ctx, width, height, horizon, horizonShift, xPan, store, scene.timeOfDay, palette)) {
    drawBackground(ctx, width, height, horizon, horizonShift, xPan, palette, scene.time);
  }
  // Weather drifts over the painted sky — but not through a tunnel roof.
  drawClouds(ctx, width, horizon, horizonShift + xPan, palette, scene.time, scene.enclosure ?? 0);

  // Road, far to near so nearer segments overwrite fog on farther ones.
  // Anything at or past a tunnel mouth is drawn THROUGH it — see findAperture.
  const aperture = findAperture(track, baseSegment.index, height);
  const lamps: Lamp[] = [];
  let clipped = false;
  // Nearest-neighbour for the whole ground pass: the tile patterns MUST scale
  // into hard square texels, not bilinear soup. (Sprites set their own flag.)
  ctx.imageSmoothingEnabled = false;
  for (let i = drawn.length - 1; i >= 0; i -= 1) {
    const seg = drawn[i];
    const n = (seg.index - baseSegment.index + track.segments.length) % track.segments.length;
    if (aperture) {
      const past = n >= aperture.fromN;
      if (past && !clipped) {
        ctx.save();
        aperture.apply(ctx);
        clipped = true;
      } else if (!past && clipped) {
        ctx.restore(); // back out into the open before drawing the road up to it
        clipped = false;
      }
    }
    renderSegment(ctx, width, height, seg, n / ROAD.drawDistance, palette, lamps, terrain, scene.time);
  }
  if (clipped) ctx.restore();
  ctx.imageSmoothingEnabled = true;

  // Cap the ceiling. The road pass culls the nearest segments — their tarmac
  // projects off the bottom of the screen, so they are skipped — and their
  // CEILINGS are culled along with them. Those are precisely the ones whose roof
  // sits above the top of the frame, so without this you drive through a hundred
  // metres of hillside with a clear strip of blue sky overhead. Fill from the top
  // of the frame down to the nearest ceiling that DID survive.
  if (baseSegment.overhead?.kind === 'tunnel' && drawn.length) {
    const nearest = drawn[0]; // the road loop pushes near-to-far
    const roofY = upFrom(nearest.p1.screen, ROOF_Y, height);
    if (roofY > -height * ROLL_BLEED) {
      ctx.fillStyle = mix('#20242b', palette.fog, 0.1);
      ctx.fillRect(-width * ROLL_BLEED, -height * ROLL_BLEED, width * (1 + 2 * ROLL_BLEED), roofY + height * ROLL_BLEED);
    }
  }

  // Glare, over the sky and the road but UNDER the traffic and the rider — a
  // flare that washes out the car you are about to hit is a lens effect that has
  // started playing the game for you. Killed under cover, where there is no sun.
  const sunlit = 1 - clamp(scene.enclosure ?? 0, 0, 1);
  if (sunlit > 0.02) {
    drawSunFlare(ctx, width, height, horizon, xPan, x * 0.02, palette, scene.boost, sunlit);
  }

  // Entities: gather within the drawn window, sort far -> near, draw with clip.
  const entities: EntityDraw[] = [];
  const maxFwd = ROAD.drawDistance * ROAD.segmentLength * 0.92;
  // Project an entity at its EXACT z by interpolating across its home segment,
  // so sprites glide smoothly instead of snapping a whole segment at a time —
  // the old cause of the "flickering / jittering cars". Both p1 and p2 of that
  // segment were projected this frame (it's inside the draw window), so this is
  // never stale. Entities behind the camera (fwd < 0) are dropped outright.
  const pushEntity = (z: number, offset: number, sprite: string, bobY: number): void => {
    const fwd = signedForward(z, player.z, track.length);
    if (fwd < 0 || fwd > maxFwd) return;
    const seg = findSegment(track, z);
    const p1 = seg.p1.screen;
    const p2 = seg.p2.screen;
    const frac = clamp((wrap(z, track.length) - seg.index * ROAD.segmentLength) / ROAD.segmentLength, 0, 1);
    const scale = lerp(p1.scale, p2.scale, frac);
    if (scale <= 0) return;
    entities.push({ sx: lerp(p1.x, p2.x, frac), sy: lerp(p1.y, p2.y, frac), scale, clip: seg.clip, offset, sprite, bobY, fwd });
  };

  for (const pickup of world.pickups) {
    if (pickup.taken) continue;
    pushEntity(pickup.z, pickup.offset, PICKUP_SPRITE[pickup.kind] ?? 'pickup-petrol', Math.sin(pickup.bob * 3) * 0.05);
  }
  for (const car of world.traffic) {
    const drift = Math.sin(car.driftPhase + world.odometerM * 0.02) * car.driftAmp;
    pushEntity(car.z, clamp(car.offset + drift, -0.85, 0.85), car.sprite, 0);
  }
  // Gate / finish arches — centred over the road so the rider drives through them.
  for (const m of world.markers) pushEntity(m.z, 0, m.sprite, 0);
  // Static scenery, gathered from the WHOLE iterated window (not just the
  // road-drawn set) so trees/houses don't flicker as their segment flips in and
  // out of the road-polygon culling near hill crests. Each sits at its segment
  // start (frac 0 → p1); hill occlusion is still handled by each segment's clip.
  for (let n = 0; n < ROAD.drawDistance; n += 1) {
    const seg = track.segments[(baseSegment.index + n) % track.segments.length];
    if (!seg.scenery.length) continue;
    // Nothing grows inside a tunnel — and nothing BEYOND one is drawn either.
    // Entities land on top of the road pass, so a cypress a hundred metres inside
    // the bore would be painted straight over the tiles it is supposedly behind.
    // (Traffic needs no such guard: cars are on the road, so they are inside the
    // walls by construction.)
    if (seg.overhead?.kind === 'tunnel') continue;
    if (aperture && n >= aperture.fromN) continue;
    const p1 = seg.p1.screen;
    if (p1.scale <= 0 || seg.p1.screen.y <= seg.p2.screen.y) continue; // behind/degenerate
    for (const item of seg.scenery) {
      const sprite = resolveScenerySprite(item.name, scene.scenery, seg.index + (item.offset > 0 ? 0.5 : 0));
      if (!sprite) continue;
      entities.push({ sx: p1.x, sy: p1.y, scale: p1.scale, clip: seg.clip, offset: item.offset, sprite, bobY: 0, fwd: n * ROAD.segmentLength });
    }
  }
  entities.sort((a, b) => b.fwd - a.fwd);
  for (const e of entities) drawEntity(ctx, width, store, e);

  // Rider. Held at a fixed screen HEIGHT (RIDER_SCREEN_FRAC is shared with
  // road.ts's RIDER_FWD, so collision happens exactly where the bike is drawn),
  // but free to swing ACROSS the frame: it sits wherever its true road position
  // projects to under the trailing camera. Sized by height so the lean frames
  // never jump scale between poses.
  const speedPct = player.speed / player.maxSpeed;
  const size = riderSize(width, height);
  const riderX = riderScreenX(width, camYaw, camLag);
  const riderY = height * RIDER_SCREEN_FRAC;

  // Tyre smoke pours out from behind the bike, so it goes down before the rider.
  if (scene.smoke) drawSmoke(ctx, scene.smoke);

  // Turbo exhaust flame — also under the rider so it licks out from the rear wheel.
  if (scene.boost > 0 && scene.wipeout === 0) {
    drawBoostFlame(ctx, riderX, riderY, size, scene.time, scene.boost);
  }
  drawRider(ctx, store, {
    x: riderX,
    y: riderY,
    size,
    lean: player.lean,
    yaw: player.yaw,
    bob: Math.sin(scene.time * 26) * speedPct * 2.5,
    wipeout: scene.wipeout,
    spin: player.z * 0.03,
    speed: speedPct,
    time: scene.time,
  });

  // Speed rush: streaks raked out of the vanishing point. Always in turbo or a
  // slingshot, and building as a draft charges so the wake FEELS like something.
  const streak = Math.max(speedPct, scene.boost, scene.sling ?? 0, (scene.draft ?? 0) * 0.8);
  if (streak > 0.5 && scene.wipeout === 0) {
    drawSpeedStreaks(ctx, width, height, width / 2 + xPan, horizon, streak, scene.time);
  }

  ctx.restore(); // end bank + off-road shake transform

  // Under cover: the light goes. Drawn over the finished scene rather than by
  // tinting every palette lookup — one multiply beats threading a light level
  // through the road, the scenery, the traffic and the rider. A cool cast, not
  // just a dimmer, because concrete under a hillside is not merely a darker
  // Amalfi Coast. The headlamp bloom keeps the bike itself readable in there.
  const enclosure = scene.enclosure ?? 0;
  if (enclosure > 0.01) {
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    // Eased back deliberately. The tunnel SEGMENTS already carry their own gloom
    // (so the bore looks dark from outside), and this rides on top of that — the
    // two multiplying at full strength took the interior to near-black, which is
    // atmospheric for about a second and unplayable thereafter.
    ctx.fillStyle = `rgba(96,112,140,${enclosure * 0.42})`;
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
    const lamp = ctx.createRadialGradient(riderX, riderY - size * 0.35, 0, riderX, riderY - size * 0.35, size * 2.1);
    lamp.addColorStop(0, `rgba(255,236,190,${enclosure * 0.3})`);
    lamp.addColorStop(1, 'rgba(255,236,190,0)');
    ctx.fillStyle = lamp;
    ctx.fillRect(0, 0, width, height);
  }
  drawLamps(ctx, lamps);

  // Beer double vision: ghost the finished scene back over itself, drifting on
  // its own slow sinusoid, then wash the colours with a gently cycling hue.
  // (Blend modes, not ctx.filter — Safari didn't support canvas filters.)
  if (wobble > 0) {
    const t = scene.time;
    ctx.save();
    ctx.globalAlpha = 0.22 * wobble;
    ctx.drawImage(ctx.canvas, Math.sin(t * 2.6) * width * 0.016 * wobble, Math.cos(t * 1.9) * height * 0.008 * wobble);
    ctx.globalCompositeOperation = 'hue';
    ctx.globalAlpha = 0.3 * wobble;
    ctx.fillStyle = `hsl(${(t * 40) % 360}, 80%, 55%)`;
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
  }

  // Fly-agaric trip: the world gently MELTS. The frame is redrawn in vertical
  // slivers, each stretching downward and swaying on its own drifting phase so
  // the scene runs like warm wax (tops stay anchored — the sky holds while the
  // road drips). A dreamy echo doubles the edges, then multi-coloured hue bands
  // slide across the melt so every part of the scene cycles through a different
  // colour. HUD still drawn clean above. (Blend modes + strip blits, not
  // ctx.filter — Safari didn't support canvas filters.)
  const trip = scene.trip ?? 0;
  if (trip > 0) {
    const t = scene.time;
    if (!tripSnap) tripSnap = document.createElement('canvas');
    if (tripSnap.width !== ctx.canvas.width || tripSnap.height !== ctx.canvas.height) {
      tripSnap.width = ctx.canvas.width;
      tripSnap.height = ctx.canvas.height;
    }
    tripSnap.getContext('2d')!.drawImage(ctx.canvas, 0, 0);
    ctx.save();
    // melt: two beat frequencies per sliver keep the drip organic, not
    // metronomic; the phases change slowly across neighbouring slivers so the
    // surface reads as liquid rather than torn strips
    const cols = 80;
    const cw = Math.ceil(width / cols);
    for (let i = 0; i < cols; i += 1) {
      const x = i * cw;
      const sway = (Math.sin(t * 1.6 + i * 0.21) + Math.sin(t * 0.9 + i * 0.09) * 0.6) * width * 0.006 * trip;
      const sag = (Math.sin(t * 1.1 + i * 0.16) + 1.4) * height * 0.028 * trip;
      ctx.drawImage(tripSnap, x, 0, cw, height, x + sway, 0, cw, height + sag);
    }
    // dreamy echo orbiting the frame — double vision without the beer hangover
    ctx.globalAlpha = 0.2 * trip;
    ctx.drawImage(tripSnap, Math.sin(t * 1.3) * width * 0.012, Math.cos(t * 1.7) * height * 0.009);
    // multi-coloured: rainbow hue bands slide diagonally across the melt
    ctx.globalCompositeOperation = 'hue';
    ctx.globalAlpha = 0.7 * trip;
    const bands = ctx.createLinearGradient(0, 0, width, height * 0.8);
    for (let i = 0; i <= 8; i += 1) {
      bands.addColorStop(i / 8, `hsl(${(i * 90 + t * 110) % 360}, 100%, 55%)`);
    }
    ctx.fillStyle = bands;
    ctx.fillRect(0, 0, width, height);
    ctx.globalCompositeOperation = 'overlay';
    ctx.globalAlpha = 0.4 * trip;
    const rainbow = ctx.createLinearGradient(0, height, width, 0);
    for (let i = 0; i <= 6; i += 1) {
      rainbow.addColorStop(i / 6, `hsl(${(i * 60 + t * 120) % 360}, 100%, 60%)`);
    }
    ctx.fillStyle = rainbow;
    ctx.fillRect(0, 0, width, height);
    // breathing rainbow rings rippling out from the horizon
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 4; i += 1) {
      const p = (t * 0.55 + i / 4) % 1;
      ctx.globalAlpha = 0.16 * trip * (1 - p);
      ctx.strokeStyle = `hsl(${(t * 200 + i * 90) % 360}, 100%, 65%)`;
      ctx.lineWidth = 6 + p * 26;
      ctx.beginPath();
      ctx.arc(width / 2, height * 0.55, p * width * 0.6 + 10, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  // Turbo warm-speed vignette (drawn un-shaken, over the scene, under the HUD).
  if (scene.boost > 0) {
    const g = ctx.createRadialGradient(width / 2, height * 0.62, height * 0.18, width / 2, height * 0.62, width * 0.72);
    g.addColorStop(0, 'rgba(255,150,70,0)');
    g.addColorStop(1, `rgba(255,95,45,${scene.boost * 0.3})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, width, height);
  }

  // Slingshot vignette: a cool rush of air, distinct from the warm rose turbo.
  const sling = scene.sling ?? 0;
  if (sling > 0) {
    const g = ctx.createRadialGradient(width / 2, height * 0.62, height * 0.2, width / 2, height * 0.62, width * 0.72);
    g.addColorStop(0, 'rgba(120,200,255,0)');
    g.addColorStop(1, `rgba(90,170,255,${sling * 0.22})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, width, height);
  }

  // Crash impact vignette: a red pulse that fades with the spin-out.
  if (impact > 0) {
    const g = ctx.createRadialGradient(width / 2, height * 0.55, height * 0.2, width / 2, height * 0.55, width * 0.75);
    g.addColorStop(0, 'rgba(255,40,60,0)');
    g.addColorStop(1, `rgba(255,30,50,${impact * 0.42})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, width, height);
  }
}

/**
 * Flickering nitro cone behind the rear wheel during a rose boost — three
 * additive layers (orange shell, amber body, near-white core) whose length and
 * width jitter at different rates so it reads as fire, not a static decal.
 */
function drawBoostFlame(ctx: CanvasRenderingContext2D, cx: number, baseY: number, size: number, time: number, boost: number): void {
  const flick = 0.8 + 0.2 * Math.sin(time * 47) + 0.1 * Math.sin(time * 89 + 1.7);
  const len = size * (0.45 + 0.45 * boost) * flick;
  const w = size * 0.2 * (0.85 + 0.25 * Math.sin(time * 61));
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const layers: [number, number, string][] = [
    [1, 1, 'rgba(255,90,30,0.5)'],
    [0.62, 0.7, 'rgba(255,170,50,0.65)'],
    [0.34, 0.45, 'rgba(255,240,180,0.85)'],
  ];
  for (const [lw, ll, color] of layers) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(cx - w * lw, baseY - size * 0.03);
    ctx.quadraticCurveTo(cx, baseY + len * ll, cx + w * lw, baseY - size * 0.03);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

// ---- tunnels and overpasses -------------------------------------------------
// Everything else in the scenery kit stands BESIDE the road. Nothing crosses it,
// and a road you never pass under reads as flat however densely you decorate its
// verges — you get no sense of a ceiling, so you get no sense of a world.
//
// Sizes are in the same units as the road, so projection scales them for free:
// x in road half-widths, y in world units above the tarmac.

/** Walls stand just outside the verge. */
const WALL_X = 1.34;
/** Roof height above the road. The camera eye is at 1150, so this clears it. */
const ROOF_Y = 1750;
/** How thick a bridge deck looks head-on. */
const DECK_THICK = 480;
/** Ceiling lamps every this many segments — the strobe IS the speed cue. */
const LAMP_SPACING = 4;

/** Screen y of a point `worldUp` above the road at a projected road point. */
function upFrom(p: { y: number; scale: number }, worldUp: number, canvasHeight: number): number {
  return p.y - p.scale * worldUp * (canvasHeight / 2);
}

/**
 * The one thing a tunnel MUST do: everything past the mouth is visible only
 * THROUGH the mouth.
 *
 * Without this the bore leaks. A villa standing beside the road a hundred metres
 * inside the tunnel sits far outside the walls in world space — but it is also
 * further away, so it projects to a SMALLER screen offset than the mouth does,
 * and it lands inside the aperture. You end up looking down a tunnel at trees and
 * grass and coastline, lit by a sun that cannot possibly reach them. Filling
 * around the walls does not fix it, because the leak is in front of the walls in
 * screen space, not behind them.
 *
 * So the aperture becomes a clip. Everything at or beyond it is drawn through the
 * hole, which is exactly the constraint the real geometry imposes.
 */
interface Aperture {
  /**
   * The FIRST camera-relative offset that must be drawn through the hole. The
   * mouth plane itself is NOT clipped — it is the thing the hole is cut in, and
   * clipping the entrance segment to its own aperture erases the hillside around
   * it, leaving a tunnel that appears to float in mid-air with no portal at all.
   */
  fromN: number;
  /** The mouth, as a screen-space path. */
  apply: (ctx: CanvasRenderingContext2D) => void;
}

function findAperture(track: Track, baseIndex: number, height: number): Aperture | null {
  const segments = track.segments;
  const here = segments[baseIndex].overhead;

  // Inside a tunnel already: the thing to look through is the far END, and the
  // same leak applies in reverse — the world beyond the exit would otherwise be
  // painted straight over the walls you are still between.
  if (here?.kind === 'tunnel' && baseIndex <= here.end) {
    const exit = segments[here.end % segments.length];
    return apertureAt(exit.p2.screen, height, here.end - baseIndex + 1);
  }

  // Otherwise, the nearest tunnel mouth ahead of us inside the draw window.
  for (let n = 0; n < ROAD.drawDistance; n += 1) {
    const seg = segments[(baseIndex + n) % segments.length];
    const overhead = seg.overhead;
    if (overhead?.kind !== 'tunnel') continue;
    if (seg.index !== overhead.start) continue; // only the mouth, not mid-bore
    return apertureAt(seg.p1.screen, height, n + 1);
  }
  return null;
}

function apertureAt(
  face: { x: number; y: number; w: number; scale: number },
  height: number,
  fromN: number,
): Aperture | null {
  if (face.w <= 0 || face.scale <= 0) return null;
  const l = face.x - face.w * WALL_X;
  const r = face.x + face.w * WALL_X;
  const roof = upFrom(face, ROOF_Y, height);
  const floor = face.y;
  return {
    fromN,
    apply: (ctx: CanvasRenderingContext2D): void => {
      ctx.beginPath();
      ctx.moveTo(l, floor);
      ctx.lineTo(l, roof);
      ctx.lineTo(r, roof);
      ctx.lineTo(r, floor);
      ctx.closePath();
      ctx.clip();
    },
  };
}

/**
 * The tunnel bore for one segment: two walls and a ceiling, drawn straight after
 * that segment's tarmac so it paints over the sky.
 *
 * This works ONLY because segments are drawn far-to-near. The mouth (below) is
 * painted during the ENTRANCE segment's turn, by which point every segment deeper
 * in has already gone down — so the facade can be laid over the lot with a hole
 * punched through it, and the interior shows through the hole rather than being
 * buried under the hillside.
 */
/**
 * One horizontal course of a receding tunnel wall, between height fractions
 * t0..t1 (0 = ceiling, 1 = road). The vertical edges stay put; only the band's
 * top and bottom slide down each edge, so a stack of these paints a tiled wall
 * in true perspective for free.
 */
function wallBand(
  ctx: CanvasRenderingContext2D,
  xNear: number,
  xFar: number,
  roofN: number,
  floorN: number,
  roofF: number,
  floorF: number,
  t0: number,
  t1: number,
  color: string,
): void {
  polygon(
    ctx,
    xNear, lerp(roofN, floorN, t0),
    xFar, lerp(roofF, floorF, t0),
    xFar, lerp(roofF, floorF, t1),
    xNear, lerp(roofN, floorN, t1),
    color,
  );
}

function drawBore(
  ctx: CanvasRenderingContext2D,
  h: number,
  seg: Segment,
  overhead: NonNullable<Segment['overhead']>,
  fog: number,
  palette: Palette,
): void {
  const p1 = seg.p1.screen;
  const p2 = seg.p2.screen;
  if (p1.w <= 0 || p2.w <= 0) return;

  const l1 = p1.x - p1.w * WALL_X;
  const r1 = p1.x + p1.w * WALL_X;
  const l2 = p2.x - p2.w * WALL_X;
  const r2 = p2.x + p2.w * WALL_X;
  const roof1 = upFrom(p1, ROOF_Y, h);
  const roof2 = upFrom(p2, ROOF_Y, h);
  const tunnel = overhead.kind === 'tunnel';
  const haze = (1 - fog) * 0.8;

  // A road-tunnel wall reads in COURSES, not one flat grey: a shadow line under
  // the ceiling, a grey upper wall, a lit ceramic dado, an amber service stripe,
  // and a dark skirting kerb at the road. Each is hazed toward the region fog
  // with depth so the bore recedes into its own gloom. This is what lifts the
  // interior from "flat concrete box" to something with 32-bit surface.
  if (tunnel) {
    const cShadow = mix('#191c22', palette.fog, haze);
    const cUpper = mix('#39404a', palette.fog, haze);
    const cLedge = mix('#5a626e', palette.fog, haze);
    const cStripe = mix('#c98a2e', palette.fog, haze); // sodium-amber safety band
    const cDado = mix('#9aa2ae', palette.fog, haze); // lit ceramic tiling
    const cKerb = mix('#141117', palette.fog, haze);
    // course boundaries, ceiling(0) -> road(1)
    const courses: Array<[number, number, string]> = [
      [0.0, 0.1, cShadow],
      [0.1, 0.52, cUpper],
      [0.52, 0.56, cLedge],
      [0.56, 0.62, cStripe],
      [0.62, 0.92, cDado],
      [0.92, 1.0, cKerb],
    ];
    for (const [xn, xf] of [[l1, l2], [r1, r2]] as const) {
      for (const [t0, t1, color] of courses) {
        wallBand(ctx, xn, xf, roof1, p1.y, roof2, p2.y, t0, t1, color);
      }
    }
  }

  // Ceiling: dark, with a slightly lifted rib down the centre where the strip
  // lights hang — gives the roof a spine to read the speed against.
  const roof = mix('#20242b', palette.fog, haze);
  polygon(ctx, l1, roof1, r1, roof1, r2, roof2, l2, roof2, roof);
  if (tunnel) {
    const rib = mix('#2b303c', palette.fog, haze);
    const c1 = (l1 + r1) / 2;
    const c2 = (l2 + r2) / 2;
    const rw1 = (r1 - l1) * 0.16;
    const rw2 = (r2 - l2) * 0.16;
    polygon(ctx, c1 - rw1, roof1, c1 + rw1, roof1, c2 + rw2, roof2, c2 - rw2, roof2, rib);
  }
}

/**
 * Strip lights on the ceiling. A tunnel's whole job, visually, is to turn your
 * speed into something you can COUNT — outside there is scenery for that, in here
 * there is nothing else at all.
 *
 * Drawn AFTER the gloom and additively, because they are the light source. Painted
 * under the shading (as they first were) they get dimmed along with the concrete
 * they are supposed to be lighting, and the tunnel goes from dark to pitch black
 * with nothing left to read your speed against.
 */
interface Lamp {
  x: number;
  y: number;
  w: number;
  h: number;
  tunnel: boolean;
}

function collectLamp(lamps: Lamp[], w: number, h: number, seg: Segment, tunnel: boolean): void {
  if (seg.index % LAMP_SPACING !== 0) return;
  const p = seg.p1.screen;
  if (p.w <= 0) return;
  lamps.push({
    x: p.x,
    y: upFrom(p, ROOF_Y, h),
    // CAPPED. Sized purely off the projected road width, the nearest lamps come
    // out hundreds of pixels across — and their glow, scaled from that, blows the
    // whole corner of the frame into one white hotspot. A light fitting is a light
    // fitting; it does not grow to the size of a house because you are close to it.
    w: clamp(p.w * 0.09, 2, w * 0.05),
    h: Math.max(1, Math.min(p.w * 0.02, h * 0.012)),
    tunnel,
  });
}

/**
 * Paint the strip lights, additively, AFTER the darkness has been laid over the
 * scene — because a light is emissive and has no business being dimmed by the
 * gloom it is supposedly casting. Drawn under the multiply (as they first were)
 * the lamps came out as cold blue-grey slabs floating in the dark: the ambient
 * shade was tinting the one thing in the tunnel that is generating its own light.
 */
function drawLamps(ctx: CanvasRenderingContext2D, lamps: readonly Lamp[]): void {
  if (!lamps.length) return;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const lamp of lamps) {
    const reach = lamp.w * 1.6;
    const glow = ctx.createRadialGradient(lamp.x, lamp.y, 0, lamp.x, lamp.y, reach);
    glow.addColorStop(0, `rgba(255,222,150,${lamp.tunnel ? 0.34 : 0.2})`);
    glow.addColorStop(1, 'rgba(255,222,150,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(lamp.x - reach, lamp.y - reach, reach * 2, reach * 2);
    ctx.fillStyle = `rgba(255,244,214,${lamp.tunnel ? 0.95 : 0.55})`;
    ctx.fillRect(lamp.x - lamp.w / 2, lamp.y - lamp.h / 2, lamp.w, lamp.h);
  }
  ctx.restore();
}

/**
 * The mouth. A rock face across the whole frame with the bore's cross-section cut
 * out of it, so you drive INTO something rather than at a floating ceiling.
 *
 * The hole is a genuine hole — an even-odd fill, not a dark rectangle with a
 * lighter one on top — because the tunnel interior is already on the canvas
 * underneath and has to survive.
 */
function drawPortal(
  ctx: CanvasRenderingContext2D,
  h: number,
  seg: Segment,
  overhead: NonNullable<Segment['overhead']>,
  palette: Palette,
): void {
  const p = seg.p1.screen;
  if (p.w <= 0 || p.scale <= 0) return;
  const l = p.x - p.w * WALL_X;
  const r = p.x + p.w * WALL_X;
  const roof = upFrom(p, ROOF_Y, h);
  const deck = upFrom(p, ROOF_Y + DECK_THICK, h);
  const face = mix('#4a5058', palette.fog, 0.25);

  if (overhead.kind === 'overpass') {
    // A bridge, not a hillside: just the deck's front face and two legs. You can
    // still see the sky and the land either side of it, which is the whole
    // difference between passing under a bridge and entering a tunnel.
    polygon(ctx, l, roof, r, roof, r, deck, l, deck, face);
    // Sun-caught top lip and a shadowed soffit, so the deck reads as a solid slab
    // with thickness rather than a flat grey band.
    const lip = Math.max(1, (roof - deck) * 0.16);
    ctx.fillStyle = mix('#767d86', palette.fog, 0.2);
    ctx.fillRect(l, deck, r - l, lip);
    ctx.fillStyle = 'rgba(0,0,0,0.34)'; // shadow under the deck
    ctx.fillRect(l, roof - lip, r - l, lip);
    const leg = Math.max(2, p.w * 0.09);
    ctx.fillStyle = mix('#3f454d', palette.fog, 0.2);
    ctx.fillRect(l - leg, roof, leg, p.y - roof);
    ctx.fillRect(r, roof, leg, p.y - roof);
    ctx.fillStyle = 'rgba(255,255,255,0.12)'; // lit outer edge of each leg
    ctx.fillRect(l - leg, roof, Math.max(1, leg * 0.22), p.y - roof);
    ctx.fillRect(r, roof, Math.max(1, leg * 0.22), p.y - roof);
    return;
  }

  // A BUILT concrete portal that FRAMES the mouth, sized off the opening itself —
  // wing walls the width of half the mouth, a header beam above it, a coping cap.
  // The old design was a full hillside sized off ROOF_Y and the canvas height; on
  // a tall phone screen that mountain swallowed the entire coast — sky, sea and
  // all — which is the "on mobile it's all wall" complaint. Tying every dimension
  // to the on-screen opening makes the facade grow WITH the mouth (small and
  // distant, then filling the frame as you plunge in) and, crucially, leaves the
  // painted backdrop visible above and to the sides at every aspect ratio.
  const mouthW = r - l;
  const openH = Math.max(1, p.y - roof);
  const wing = mouthW * 0.4; // wall each side of the opening
  const headH = openH * 0.36; // header kept low so more sky/coast shows above it —
                              // on a tall phone that top band IS the backdrop
  const batter = wing * 0.18; // sides lean in toward the top → retaining-wall look
  const oL = l - wing;
  const oR = r + wing;
  const topY = roof - headH;
  const base = mix('#565d67', palette.fog, 0.22);

  // Facade silhouette (battered trapezoid) with the bore's cross-section wound as
  // a second sub-path: even-odd leaves the opening a genuine HOLE, so the interior
  // already on the canvas survives.
  const facade = new Path2D();
  facade.moveTo(oL, p.y);
  facade.lineTo(oL + batter, topY);
  facade.lineTo(oR - batter, topY);
  facade.lineTo(oR, p.y);
  facade.closePath();
  facade.moveTo(l, p.y);
  facade.lineTo(l, roof);
  facade.lineTo(r, roof);
  facade.lineTo(r, p.y);
  facade.closePath();
  ctx.fillStyle = base;
  ctx.fill(facade, 'evenodd');

  // Surface detail, all clipped to the facade so it can't bleed onto sky or road.
  ctx.save();
  ctx.clip(facade, 'evenodd');
  // top-lit vertical ramp: bright coping, shadowed toward the road
  const lit = ctx.createLinearGradient(0, topY, 0, p.y);
  lit.addColorStop(0, 'rgba(255,255,255,0.14)');
  lit.addColorStop(0.4, 'rgba(255,255,255,0)');
  lit.addColorStop(1, 'rgba(0,0,0,0.28)');
  ctx.fillStyle = lit;
  ctx.fillRect(oL, topY, oR - oL, p.y - topY);
  // horizontal block courses
  ctx.strokeStyle = 'rgba(0,0,0,0.16)';
  ctx.lineWidth = Math.max(1, openH * 0.012);
  const course = Math.max(6, openH * 0.15);
  for (let y = topY + course; y < p.y; y += course) {
    ctx.beginPath();
    ctx.moveTo(oL, y);
    ctx.lineTo(oR, y);
    ctx.stroke();
  }
  // vertical control joints down the wing walls
  ctx.beginPath();
  ctx.moveTo(l - wing * 0.5, topY); ctx.lineTo(l - wing * 0.5, p.y);
  ctx.moveTo(r + wing * 0.5, topY); ctx.lineTo(r + wing * 0.5, p.y);
  ctx.stroke();
  ctx.restore();

  // Recessed reveal: a dark inner shadow just outside the opening + a bright
  // chamfer catching the light, so the mouth reads as a thick portal, not a
  // sticker. Drawn as strokes hugging the opening edges (top and two jambs).
  ctx.lineJoin = 'miter';
  ctx.strokeStyle = 'rgba(0,0,0,0.55)';
  ctx.lineWidth = Math.max(2, mouthW * 0.05);
  ctx.beginPath();
  ctx.moveTo(l, p.y); ctx.lineTo(l, roof); ctx.lineTo(r, roof); ctx.lineTo(r, p.y);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.16)';
  ctx.lineWidth = Math.max(1, mouthW * 0.02);
  const inset = Math.max(1, mouthW * 0.03);
  ctx.beginPath();
  ctx.moveTo(l + inset, p.y); ctx.lineTo(l + inset, roof + inset); ctx.lineTo(r - inset, roof + inset); ctx.lineTo(r - inset, p.y);
  ctx.stroke();

  // Coping cap: a lipped beam across the top edge, lighter than the wall, with a
  // shadow line under it — the portal's crown.
  const cap = openH * 0.08;
  ctx.fillStyle = mix('#6b727c', palette.fog, 0.2);
  ctx.fillRect(oL + batter - wing * 0.12, topY - cap, oR - oL - 2 * batter + wing * 0.24, cap);
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fillRect(oL + batter - wing * 0.12, topY, oR - oL - 2 * batter + wing * 0.24, Math.max(1, cap * 0.22));
}

// ---- sun glare and lens flare ----------------------------------------------
// Where the sun sits on screen. The backdrops are painted art, so nothing here can
// know where the real sun is in the picture — but the code-drawn fallback puts it
// at 0.68 across and a little above the shoreline, and matching that keeps the
// flare honest against either. It rides the camera yaw like everything else, so it
// swings through a corner instead of being stuck to the glass.
const SUN_X_FRAC = 0.68;

/**
 * Glare, and the ghosts it throws down the lens.
 *
 * This is not a "bloom" in the post-processing sense — a real one needs the frame
 * read back, thresholded and blurred, which on a 2D canvas costs more than the
 * whole rest of the scene put together and would tank a phone. What actually sells
 * a bright sun is far cheaper: a hot core, a wide halo, and a handful of ghost
 * discs marching along the line from the sun THROUGH the centre of the frame,
 * which is where a real lens puts them. Additive, so it only ever brightens.
 */
function drawSunFlare(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  horizon: number,
  xPan: number,
  curveShift: number,
  palette: Palette,
  boost: number,
  visibility: number,
): void {
  // The sun is out in the daytime and at sunset; there is nothing to flare at
  // midnight, and a moon that throws lens ghosts is a bug, not a feature.
  // Every region on this journey is bright daylight, so the flare has to hold its
  // own against a blazing sky — at the first, physically-demure strength it was
  // simply invisible, which is a feature that costs frames and delivers nothing.
  const day = 1 - clamp(palette.star, 0, 1);
  // Eased back from the first cut: the halo and lens ghosts were bright enough to
  // wash out the road and the traffic on the run into a low sun — which reads as
  // "the finish went murky and slow" rather than "what a sunset". Keep the sunset
  // character (halo + streak) but take the edge off the wash, most of all the
  // ghosts marching down the frame toward the bike.
  const strength = day * (0.7 + boost * 0.3) * clamp(visibility, 0, 1);
  if (strength <= 0.02) return;

  const sx = w * SUN_X_FRAC - curveShift * 0.45 + xPan;
  const sy = horizon - h * 0.16;
  const r = h * 0.085;

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';

  // Halo — the wide, soft bloom of light scattering in the air around it.
  const halo = ctx.createRadialGradient(sx, sy, r * 0.2, sx, sy, r * 6);
  halo.addColorStop(0, rgba(palette.sun, 0.58 * strength));
  halo.addColorStop(0.25, rgba(palette.sun, 0.18 * strength));
  halo.addColorStop(1, rgba(palette.sun, 0));
  ctx.fillStyle = halo;
  ctx.fillRect(sx - r * 6, sy - r * 6, r * 12, r * 12);

  // Ghosts: reflections between the elements of the lens, so they fall on the
  // line through the frame's centre, on the OPPOSITE side to the sun.
  const cx = w / 2;
  const cy = h / 2;
  const dx = cx - sx;
  const dy = cy - sy;
  const ghosts: Array<[number, number, string]> = [
    [0.42, 0.30, palette.sun],
    [0.78, 0.16, '#8fd0ff'],
    [1.15, 0.24, '#ffd76b'],
    [1.55, 0.13, '#8fe6c4'],
    [1.9, 0.2, palette.sun],
  ];
  for (const [t, size, colour] of ghosts) {
    const gx = sx + dx * t * 2;
    const gy = sy + dy * t * 2;
    const gr = r * size * 2.4;
    const g = ctx.createRadialGradient(gx, gy, 0, gx, gy, gr);
    g.addColorStop(0, rgba(colour, 0.08 * strength));
    g.addColorStop(0.7, rgba(colour, 0.035 * strength));
    g.addColorStop(1, rgba(colour, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(gx, gy, gr, 0, Math.PI * 2);
    ctx.fill();
  }

  // A horizontal streak across the sun — the anamorphic smear every arcade racer
  // has ever put over its sunset, and the thing that reads as "bright" fastest.
  const streak = ctx.createLinearGradient(sx - r * 9, sy, sx + r * 9, sy);
  streak.addColorStop(0, rgba(palette.sun, 0));
  streak.addColorStop(0.5, rgba(palette.sun, 0.34 * strength));
  streak.addColorStop(1, rgba(palette.sun, 0));
  ctx.fillStyle = streak;
  ctx.fillRect(sx - r * 9, sy - r * 0.09, r * 18, r * 0.18);

  ctx.restore();
}

/** Reflector posts every this many segments down each verge. */
const POST_SPACING = ROAD.rumbleSegments * 3;

/**
 * Marker posts standing off each verge. They are pure speed-reading: evenly
 * spaced verticals streaming past at the road's edge give the eye a metronome
 * that flat tarmac and fog cannot, and the faster you go the harder they strobe.
 * Every other pair carries a red reflector, so they read at distance too.
 */
function drawPosts(ctx: CanvasRenderingContext2D, seg: Segment, fade: number): void {
  const p = seg.p1.screen;
  if (p.w <= 0 || fade <= 0.02) return;
  // Sized in ROAD-WIDTHS, so projection scales them for free: a post right under
  // the camera is enormous, but it is also several screen-widths off to the side,
  // so it simply never enters frame. The ones you see are at a sane depth.
  const stand = p.w * 1.22; // just outside the rumble strip
  const height = p.w * 0.16;
  const thick = Math.max(1, p.w * 0.022);
  const reflector = Math.floor(seg.index / POST_SPACING) % 2 === 0;
  ctx.globalAlpha = fade;
  for (const side of [-1, 1] as const) {
    const px = p.x + side * stand;
    ctx.fillStyle = '#e8eef2';
    ctx.fillRect(px - thick / 2, p.y - height, thick, height);
    if (reflector) {
      ctx.fillStyle = side < 0 ? '#ff5d78' : '#ffd76b';
      ctx.fillRect(px - thick, p.y - height, thick * 2, Math.max(1, height * 0.28));
    }
  }
  ctx.globalAlpha = 1;
}

// How far out (in road-widths) the flat verge runs before the terrain takes
// over. Beyond the tree/sign/billboard prop band (which reaches ~2.5), so props
// sit on the verge and never float over water or thin air.
const VERGE = 3.1;

function shade(hex: string, amount: number): string {
  const [r, g, b] = hexToRgb(hex);
  const f = 1 + amount;
  const c = (v: number): number => Math.round(clamp(v * f, 0, 255));
  return `rgb(${c(r)},${c(g)},${c(b)})`;
}

// --- 32-bit ground texture ---------------------------------------------------
// The ground is TEXTURED, not tinted: each material gets a hand-authored pixel
// tile (painted live from the biome palette), drawn in perspective per segment
// with nearest-neighbour sampling, so the texels swell into fat chunky pixels
// as they rush the camera — the Mega Drive ground that flat fills never were.
// Tiles are deterministic (hashed art, keyed off the palette colour) and the
// vertical phase rides the segment index, so the texture STREAMS under the
// bike with the road instead of sticking to the glass. Distant bands — where
// a texel would be sub-pixel mush — stay flat colour under the fog.

const TILE = 48;
/** How loudly this band's texture draws: 1 up close, easing to 0 out where
 *  the texels drop sub-pixel and the distance fog owns the frame. A hard LOD
 *  cutover drew a visible seam across the world (flat band before the
 *  horizon); a fade is invisible — and skipping the fills that would land at
 *  alpha 0 keeps the pattern-pass cost bounded (hundreds of 2px far bands
 *  each paying fill overhead added ~50% frame time in software rendering). */
function bandTexAlpha(seg: Segment): number {
  if (seg.p1.screen.y - seg.p2.screen.y < 1) return 0;
  return clamp((seg.p1.screen.w - 22) / 38, 0, 1);
}

/** Per-material texture styling.
 *  - `tint`: 'palette' swaps the art's hue for the band colour (luminosity
 *    blend) so one texture serves every biome; 'natural' keeps the art's own
 *    colours (autumn leaf reds, ember orange, wave blues) — used where the
 *    material only appears under palettes it already matches.
 *  - `texels`: how many texture pixels span half the road — the zoom. 48 is
 *    fat chunky ground; the tarmac runs much finer or it reads as cobbles.
 *  - `rows`: texture rows per segment (scales vertical texel to match).
 *  - `strength`: how loudly the texture reads over the flat band colour. */
const TILE_STYLE: Record<TileKind, { tint: 'palette' | 'natural'; texels: number; rows: number; strength: number }> = {
  grass: { tint: 'palette', texels: 48, rows: 3, strength: 0.8 },
  sand: { tint: 'palette', texels: 48, rows: 3, strength: 0.7 },
  snow: { tint: 'palette', texels: 48, rows: 3, strength: 0.55 },
  salt: { tint: 'palette', texels: 48, rows: 3, strength: 0.55 },
  leaves: { tint: 'natural', texels: 48, rows: 3, strength: 0.95 },
  ash: { tint: 'natural', texels: 48, rows: 3, strength: 0.9 },
  asphalt: { tint: 'palette', texels: 64, rows: 4, strength: 0.6 },
  rock: { tint: 'palette', texels: 56, rows: 3, strength: 0.65 },
  tarmac: { tint: 'palette', texels: 96, rows: 6, strength: 0.16 },
  water: { tint: 'natural', texels: 64, rows: 4, strength: 0.8 },
};

/** Perspective transform mapping tile texels onto this segment's ground band:
 *  texel width tracks the projected road width, and the material's row count
 *  spans the band so the pattern scrolls with z and foreshortens with depth.
 *  `texH` is the tile's pixel height (the generated art tiles are taller than
 *  the procedural ones — same texel size, longer repeat). */
function groundMatrix(seg: Segment, texH: number, kind: TileKind): DOMMatrix {
  const style = TILE_STYLE[kind];
  const p1 = seg.p1.screen;
  const rowT = (p1.y - seg.p2.screen.y) / style.rows;
  return new DOMMatrix([
    Math.max(0.35, p1.w / style.texels), 0,
    0, -rowT,
    p1.x, p1.y + ((seg.index * style.rows) % texH) * rowT,
  ]);
}

// Tinted tiles are cached per (material, colour). Palette transitions retint
// every frame for ~a fifth of a leg, so the cache is bounded and just cleared
// when it fills — rebuilding a tile is trivia next to a frame.
const tileCache = new Map<string, GroundTile | null>();

type TileKind = GroundKind | 'rock' | 'tarmac' | 'water';
interface GroundTile { pat: CanvasPattern; h: number }

/** The generated texture each material wears; set by renderScene each frame
 *  (the store loads async — until a texture lands, the procedural tile runs). */
let groundArt: SpriteStore | null = null;

const ART_TEX: Record<TileKind, string> = {
  grass: 'texture-grass',
  sand: 'texture-sand',
  snow: 'texture-snow',
  salt: 'texture-snow', // the lilac tint does the salt
  leaves: 'texture-leaves',
  ash: 'texture-ash',
  asphalt: 'texture-asphalt',
  rock: 'texture-rock',
  tarmac: 'texture-tarmac',
  water: 'texture-water',
};

function groundPattern(ctx: CanvasRenderingContext2D, kind: TileKind, base: string, warm = '', dark = false): GroundTile | null {
  const art = groundArt?.get(ART_TEX[kind]) ?? null;
  const key = `${kind}|${base}|${warm}|${dark ? 'd' : 'l'}|${art ? 'a' : 'p'}`;
  let tile = tileCache.get(key);
  if (tile === undefined) {
    const cv = document.createElement('canvas');
    cv.width = art ? art.w : TILE;
    cv.height = art ? art.h : TILE;
    const c = cv.getContext('2d');
    if (!c) {
      tile = null;
    } else {
      if (art) {
        const style = TILE_STYLE[kind];
        c.fillStyle = base;
        c.fillRect(0, 0, cv.width, cv.height);
        // 'palette' materials get a palette swap: keep the ART's luminance
        // (the pixel art), take the band colour's hue — one texture serves
        // every biome and still morphs through region transitions. 'natural'
        // materials keep their own colours (leaf reds, ember orange).
        c.globalCompositeOperation = style.tint === 'palette' ? 'luminosity' : 'source-over';
        c.drawImage(art.canvas, 0, 0, cv.width, cv.height);
        c.globalCompositeOperation = 'source-over';
        if (style.strength < 1) {
          // Pull the texture back toward the flat band colour — the tarmac
          // wants a whisper of aggregate, not crazy paving.
          c.globalAlpha = 1 - style.strength;
          c.fillStyle = base;
          c.fillRect(0, 0, cv.width, cv.height);
          c.globalAlpha = 1;
        }
        if (dark) {
          // The light/dark segment banding lives in the base colour's
          // luminance, which the palette swap discards — put it back.
          c.globalCompositeOperation = 'multiply';
          c.fillStyle = 'rgba(14,16,26,0.12)';
          c.fillRect(0, 0, cv.width, cv.height);
          c.globalCompositeOperation = 'source-over';
        }
      } else {
        paintTile(c, kind, base, warm);
      }
      const pat = ctx.createPattern(cv, 'repeat');
      tile = pat ? { pat, h: cv.height } : null;
    }
    if (tileCache.size > 160) tileCache.clear();
    tileCache.set(key, tile);
  }
  return tile;
}

/** The pixel art itself — one 48x48 tile per material, built from the band's
 *  base colour. All placement is hash()-driven, so the art is stable. */
function paintTile(c: CanvasRenderingContext2D, kind: TileKind, base: string, warm: string): void {
  c.fillStyle = base;
  c.fillRect(0, 0, TILE, TILE);
  const dot = (x: number, y: number, w: number, h: number, col: string): void => {
    c.fillStyle = col;
    c.fillRect(Math.round(x), Math.round(y), w, h);
  };
  const rx = (i: number): number => hash(i * 7.13 + 3.7) * TILE;
  const ry = (i: number): number => hash(i * 3.71 + 9.1) * TILE;
  const rv = (i: number): number => hash(i * 5.39 + 1.3);
  switch (kind) {
    case 'grass': {
      const dk = shade(base, -0.14);
      const dk2 = shade(base, -0.3);
      const lt = shade(base, 0.16);
      for (let i = 0; i < 130; i += 1) dot(rx(i), ry(i), 1, 1, rv(i) > 0.24 ? dk : lt);
      for (let i = 200; i < 212; i += 1) { // tufts
        const x = rx(i);
        const y = ry(i);
        dot(x, y, 1, 2, dk2);
        dot(x + 1, y + 1, 1, 2, dk2);
        if (rv(i) > 0.5) dot(x, y - 1, 1, 1, lt);
      }
      break;
    }
    case 'sand': {
      const dk = shade(base, -0.12);
      const dk2 = shade(base, -0.28);
      const lt = shade(base, 0.14);
      // wind ripples: broken wavy lines that tile horizontally
      for (let r = 0; r < 5; r += 1) {
        const yBase = r * (TILE / 5) + 3;
        for (let x = 0; x < TILE; x += 1) {
          if (hash(r * 131 + x * 17.7) > 0.72) continue; // broken line
          const y = yBase + Math.round(Math.sin(((x / TILE) * 4 + r * 0.7) * Math.PI) * 1.8);
          dot(x, y, 1, 1, dk);
        }
      }
      for (let i = 0; i < 46; i += 1) dot(rx(i), ry(i), 1, 1, rv(i) > 0.5 ? lt : dk);
      for (let i = 300; i < 304; i += 1) { // pebbles
        const x = rx(i);
        const y = ry(i);
        dot(x, y, 2, 2, dk2);
        dot(x, y, 1, 1, lt);
      }
      break;
    }
    case 'snow':
    case 'salt': {
      const sh = shade(base, -0.09);
      const sh2 = shade(base, -0.18);
      for (let i = 0; i < 48; i += 1) dot(rx(i), ry(i), rv(i) > 0.5 ? 2 : 1, 1, sh);
      for (let i = 100; i < 116; i += 1) dot(rx(i), ry(i), 1, 1, sh2);
      for (let i = 400; i < 412; i += 1) dot(rx(i), ry(i), 1, 1, '#ffffff');
      for (let i = 500; i < 503; i += 1) { // sparkle crosses
        const x = rx(i);
        const y = ry(i);
        dot(x, y, 1, 1, '#ffffff');
        dot(x - 1, y, 3, 1, kind === 'salt' ? '#fff0f4' : '#f4faff');
        dot(x, y - 1, 1, 3, kind === 'salt' ? '#fff0f4' : '#f4faff');
      }
      break;
    }
    case 'leaves': {
      const c1 = shade(base, -0.26);
      const c2 = shade(base, 0.2);
      const c3 = warm ? mix(base, warm, 0.55) : shade(base, -0.4);
      const twig = shade(base, -0.48);
      for (let i = 0; i < 40; i += 1) {
        const col = rv(i) > 0.62 ? c2 : rv(i) > 0.28 ? c1 : c3;
        dot(rx(i), ry(i), 2, 1, col);
      }
      for (let i = 600; i < 607; i += 1) dot(rx(i), ry(i), rv(i) > 0.5 ? 2 : 1, 1, twig);
      break;
    }
    case 'ash': {
      const g1 = shade(base, -0.26);
      const g2 = shade(base, 0.34);
      for (let i = 0; i < 64; i += 1) dot(rx(i), ry(i), 1, 1, rv(i) > 0.72 ? g2 : g1);
      for (let i = 700; i < 704; i += 1) { // embers caught in the grit
        dot(rx(i), ry(i), 1, 1, '#ff8a3c');
        if (rv(i) > 0.6) dot(rx(i) + 1, ry(i), 1, 1, '#ffb44d');
      }
      break;
    }
    case 'asphalt': {
      const lt = shade(base, 0.3);
      const dk = shade(base, -0.2);
      for (let i = 0; i < 40; i += 1) dot(rx(i), ry(i), 1, 1, rv(i) > 0.45 ? lt : dk);
      break;
    }
    case 'rock': {
      const dk = shade(base, -0.18);
      const dk2 = shade(base, -0.36);
      const lt = shade(base, 0.16);
      for (let i = 0; i < 90; i += 1) dot(rx(i), ry(i), rv(i) > 0.7 ? 2 : 1, 1, rv(i) > 0.28 ? dk : lt);
      for (let i = 800; i < 808; i += 1) dot(rx(i), ry(i), 1, 2, dk2); // crack pits
      break;
    }
    case 'tarmac': {
      const lt = shade(base, 0.09);
      const dk = shade(base, -0.11);
      const dk2 = shade(base, -0.26);
      for (let i = 0; i < 76; i += 1) dot(rx(i), ry(i), 1, 1, rv(i) > 0.5 ? lt : dk);
      for (let i = 900; i < 906; i += 1) dot(rx(i), ry(i), 1, 1, dk2);
      break;
    }
    case 'water': {
      const lt = shade(base, 0.18);
      const dk = shade(base, -0.12);
      for (let r = 0; r < 6; r += 1) { // broken wave rows that tile sideways
        const yBase = r * (TILE / 6) + 2;
        for (let x = 0; x < TILE; x += 1) {
          if (hash(r * 97 + x * 13.1) > 0.6) continue;
          const y = yBase + Math.round(Math.sin(((x / TILE) * 3 + r * 1.3) * Math.PI) * 1.4);
          dot(x, y, 1, 1, rv(r * 61 + x) > 0.85 ? '#ffffff' : lt);
        }
      }
      for (let i = 0; i < 24; i += 1) dot(rx(i), ry(i), 1, 1, dk);
      break;
    }
  }
}

/** The colour of the ground BEYOND the verge on one side, banded like the road. */
function sideColor(kind: SideKind, terrain: Terrain, palette: Palette, dark: boolean): string {
  switch (kind) {
    case 'sea': return dark ? shade(palette.sea, -0.08) : palette.sea;
    case 'drop': return dark ? shade(terrain.dropColor, -0.08) : terrain.dropColor;
    case 'cliff': return dark ? terrain.cliffDark : terrain.cliffLight;
    default: return dark ? palette.grassDark : palette.grassLight;
  }
}

/**
 * The ground either side of the verge: a rock wall climbing away on one
 * shoulder, the land falling into the sea/canyon on the other (stages.ts decides
 * which, per region). Drawn per segment far→near WITH the road, so nearer
 * terrain paints over farther terrain and the coastline stacks up correctly.
 * Skipped inside a tunnel bore, which fills its own walls.
 */
function renderSides(
  ctx: CanvasRenderingContext2D,
  width: number,
  seg: Segment,
  palette: Palette,
  terrain: Terrain,
  time: number,
): void {
  const p1 = seg.p1.screen;
  const p2 = seg.p2.screen;
  const dark = seg.color === 'dark';
  const edgeL = -width * ROLL_BLEED;
  const edgeR = width * (1 + ROLL_BLEED);

  // Verge lips: where the roadside ends and sea / cliff / canyon begins.
  const l1 = p1.x - VERGE * p1.w;
  const l2 = p2.x - VERGE * p2.w;
  const r1 = p1.x + VERGE * p1.w;
  const r2 = p2.x + VERGE * p2.w;

  // The ground beyond the lip on each side. A `flat` side is the SAME ground
  // as the verge, so it skips its fill and lets the textured slab run to the
  // frame edge; sea / canyon / rock repaint over the texture past the lip.
  const sideTexA = bandTexAlpha(seg);
  const fillSide = (kind: SideKind, x1: number, y1: number, x2: number, y2: number, x3: number, y3: number, x4: number, y4: number): void => {
    if (kind === 'flat') return;
    polygon(ctx, x1, y1, x2, y2, x3, y3, x4, y4, sideColor(kind, terrain, palette, dark));
    // Rock mottle over an open cliff shoulder; the water texture over the sea
    // (the animated surf rolls over the top of it).
    const tex: TileKind | null = kind === 'cliff' ? 'rock' : kind === 'sea' ? 'water' : null;
    if (tex && sideTexA > 0) {
      const tile = groundPattern(ctx, tex, sideColor(kind, terrain, palette, dark), '', dark);
      if (tile) {
        tile.pat.setTransform(groundMatrix(seg, tile.h, tex));
        ctx.globalAlpha = sideTexA;
        ctx.fillStyle = tile.pat;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.lineTo(x3, y3);
        ctx.lineTo(x4, y4);
        ctx.closePath();
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }
  };
  fillSide(terrain.left, edgeL, p1.y, l1, p1.y, l2, p2.y, edgeL, p2.y);
  fillSide(terrain.right, r1, p1.y, edgeR, p1.y, edgeR, p2.y, r2, p2.y);

  // A bright line of surf / rock lip where the ground gives way — what makes a
  // drop read as a DROP rather than a change of paint.
  const lip = (x1: number, x2: number, kind: SideKind): void => {
    if (kind !== 'sea' && kind !== 'drop') return;
    const c = kind === 'sea' ? rgba('#ffffff', 0.5) : rgba(palette.fog, 0.45);
    const t = Math.max(1, (p1.y - p2.y) * 0.35);
    polygon(ctx, x1, p1.y, x1, p1.y - t, x2, p2.y - t * 0.5, x2, p2.y, c);
  };
  lip(l1, l2, terrain.left);
  lip(r1, r2, terrain.right);

  // Animated material beyond the lip: rolling surf on the water, static pocks
  // over a canyon floor. Far bands are a couple of pixels tall and stay flat.
  const h = p1.y - p2.y;
  if (h < 2) return;
  const detail = (lip1: number, lip2: number, side: -1 | 1, kind: SideKind): void => {
    if (kind !== 'sea' && kind !== 'drop') return; // flat/cliff use the tile pass
    // Water gets a denser pass than rock — waves are the whole point of it.
    const n = kind === 'sea' ? Math.min(12, Math.ceil(h / 2.5)) : Math.min(16, Math.ceil(h / 3.5));
    const seaLite = shade(palette.sea, 0.3);
    const base = kind === 'sea' ? palette.sea : terrain.dropColor;
    for (let k = 0; k < n; k += 1) {
      const seed = seg.index * 5.77 + side * 91.3 + k * 37.1;
      const t = hash(seed);
      const w = lerp(p1.w, p2.w, t);
      const y = lerp(p1.y, p2.y, t);
      const lipX = lerp(lip1, lip2, t);
      const edge = side < 0 ? edgeL : edgeR;
      // Concentrate the action in the water the eye actually reads — the first
      // few road-widths off the lip; past that fog and flat colour take over.
      const span = Math.min(Math.abs(edge - lipX), w * 8);
      if (span < 2) continue;
      if (kind === 'sea') {
        // Surf dashes rolling TOWARD the shore, brightest as they arrive.
        const roll = (hash(seed + 2.9) + time * (0.10 + 0.14 * hash(seed + 8.3))) % 1;
        const off = (1 - roll) * span;
        const len = Math.min(span, Math.max(2, w * (0.4 + 0.7 * hash(seed + 4.2))));
        const th = Math.max(1, Math.round(h * 0.18));
        ctx.globalAlpha = 0.25 + 0.5 * roll;
        ctx.fillStyle = roll > 0.75 ? '#ffffff' : seaLite;
        ctx.fillRect(side < 0 ? lipX - off - len : lipX + off, y, len, th);
        ctx.globalAlpha = 1;
      } else {
        // Static mottling: darker pocks over the drop / rock shoulder.
        const off = hash(seed + 2.9) * span;
        const px = Math.max(1, Math.round(w * 0.024));
        ctx.globalAlpha = 0.5;
        ctx.fillStyle = hash(seed + 4.2) > 0.6 ? shade(base, 0.16) : shade(base, -0.2);
        ctx.fillRect(lipX + side * off, y, px + 1, px);
        ctx.globalAlpha = 1;
      }
    }
  };
  detail(l1, l2, -1, terrain.left);
  detail(r1, r2, 1, terrain.right);

  // (The old `cliff` rock/retaining wall — a flat two-tone vertical face rising
  // from the verge — has been removed. It read as a flat grey slab that clashed
  // with the pixel-art and, worse, buried the painted horizon backdrop behind a
  // featureless wall. A `cliff` side now stays open ground, so the coast / city /
  // valley art shows through where the wall used to stand.)
}

function renderSegment(ctx: CanvasRenderingContext2D, width: number, height: number, seg: Segment, fogT: number, palette: Palette, lamps: Lamp[], terrain: Terrain, time: number): void {
  const p1 = seg.p1.screen;
  const p2 = seg.p2.screen;
  const dark = seg.color === 'dark';
  const grass = dark ? palette.grassDark : palette.grassLight;
  const road = dark ? palette.roadDark : palette.roadLight;
  const rumble = dark ? palette.rumbleDark : palette.rumbleLight;
  // The view banks, so every full-width fill has to bleed past the frame or the
  // rotation exposes bare canvas in the corners.
  const bleedX = -width * ROLL_BLEED;
  const bleedW = width * (1 + 2 * ROLL_BLEED);

  // grass slab spanning full width — the sides then reclaim everything past the
  // verge with rock / sea / canyon (but a tunnel bore fills its own walls).
  ctx.fillStyle = grass;
  ctx.fillRect(bleedX, p2.y, bleedW, p1.y - p2.y + 1);
  const texA = bandTexAlpha(seg);
  if (texA > 0 && seg.overhead?.kind !== 'tunnel') {
    // The biome's pixel tile over the full slab; the sides repaint whatever
    // lies beyond a sea / canyon / rock lip on top of it.
    const tile = groundPattern(ctx, palette.ground, grass, palette.rumbleDark, dark);
    if (tile) {
      tile.pat.setTransform(groundMatrix(seg, tile.h, palette.ground));
      ctx.globalAlpha = texA;
      ctx.fillStyle = tile.pat;
      ctx.fillRect(bleedX, p2.y, bleedW, p1.y - p2.y + 1);
      ctx.globalAlpha = 1;
    }
  }
  if (seg.overhead?.kind !== 'tunnel') renderSides(ctx, width, seg, palette, terrain, time);

  const r1 = rumbleWidth(p1.w);
  const r2 = rumbleWidth(p2.w);
  polygon(ctx, p1.x - p1.w - r1, p1.y, p1.x - p1.w, p1.y, p2.x - p2.w, p2.y, p2.x - p2.w - r2, p2.y, rumble);
  polygon(ctx, p1.x + p1.w + r1, p1.y, p1.x + p1.w, p1.y, p2.x + p2.w, p2.y, p2.x + p2.w + r2, p2.y, rumble);
  polygon(ctx, p1.x - p1.w, p1.y, p1.x + p1.w, p1.y, p2.x + p2.w, p2.y, p2.x - p2.w, p2.y, road);
  if (texA > 0) {
    // Asphalt wears the same chunky texels as the ground; lane paint goes on
    // over the top so the markings stay crisp.
    const tile = groundPattern(ctx, 'tarmac', road, '', dark);
    if (tile) {
      tile.pat.setTransform(groundMatrix(seg, tile.h, 'tarmac'));
      ctx.globalAlpha = texA;
      ctx.fillStyle = tile.pat;
      ctx.beginPath();
      ctx.moveTo(p1.x - p1.w, p1.y);
      ctx.lineTo(p1.x + p1.w, p1.y);
      ctx.lineTo(p2.x + p2.w, p2.y);
      ctx.lineTo(p2.x - p2.w, p2.y);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  if (!dark) {
    const l1 = laneMarkerWidth(p1.w);
    const l2 = laneMarkerWidth(p2.w);
    const lanes = ROAD.lanes;
    for (let lane = 1; lane < lanes; lane += 1) {
      const t = lane / lanes;
      const lx1 = p1.x - p1.w + 2 * p1.w * t;
      const lx2 = p2.x - p2.w + 2 * p2.w * t;
      polygon(ctx, lx1 - l1, p1.y, lx1 + l1, p1.y, lx2 + l2, p2.y, lx2 - l2, p2.y, palette.lane);
    }
  }

  const fog = 1 / Math.exp((fogT * fogT * ROAD.fogDensity));
  // Posts sit on the tarmac (so the fog washes over them like everything else)
  // but are hidden in the far haze, where they would only shimmer.
  if (seg.index % POST_SPACING === 0) drawPosts(ctx, seg, fog);

  // Overhead structure, over this segment's tarmac and sky. Order is everything
  // here: the bore for every segment inside the span, and then — on the entrance
  // segment, which far-to-near ordering guarantees is drawn LAST of the lot — the
  // mouth, with the bore cut out of it.
  const overhead = seg.overhead;
  if (overhead) {
    drawBore(ctx, height, seg, overhead, fog, palette);
    // Shade the INTERIOR by how deep into the bore this segment sits — not by
    // where the rider is. The rider's own darkness (main.ts `enclosure`) only
    // lands once they are already inside, which leaves a tunnel that is as
    // brightly lit as the coast right up until you enter it: you approach an open
    // road with a lid on. It has to look dark in there from OUT here, and that
    // means the segments themselves carry the dark, deepening as they recede.
    const depth = clamp(Math.min(seg.index - overhead.start, overhead.end - seg.index) / 6, 0, 1);
    const gloom = overhead.kind === 'tunnel' ? depth : depth * 0.45;
    if (gloom > 0.01) {
      // From the roof down to this segment's near edge. At the mouth itself depth
      // is 0, so nothing is shaded there and the portal stays crisp; deeper
      // segments are already clipped to the aperture, so this can never spill out
      // across the sky.
      const top = Math.min(upFrom(p1, ROOF_Y, height), upFrom(p2, ROOF_Y, height));
      ctx.save();
      ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = `rgba(88,102,128,${gloom * 0.62})`;
      ctx.fillRect(bleedX, top, bleedW, p1.y - top + 1);
      ctx.restore();
    }
    collectLamp(lamps, width, height, seg, overhead.kind === 'tunnel');
    if (seg.index === overhead.start) drawPortal(ctx, height, seg, overhead, palette);
  }

  // distance fog
  if (fog < 1) {
    ctx.globalAlpha = 1 - fog;
    ctx.fillStyle = palette.fog;
    ctx.fillRect(bleedX, p2.y, bleedW, p1.y - p2.y + 1);
    ctx.globalAlpha = 1;
  }
}

function needsContactShadow(sprite: string): boolean {
  return sprite.startsWith('car-') || sprite.startsWith('scooter-') || sprite.startsWith('pickup-') || sprite === 'rose';
}

function drawEntity(ctx: CanvasRenderingContext2D, width: number, store: SpriteStore, e: EntityDraw): void {
  const sprite = store.get(e.sprite);
  if (!sprite) return;
  if (e.scale <= 0) return;
  const worldW = spriteWorldWidth(e.sprite);
  const destW = e.scale * worldW * ROAD.roadWidth * (width / 2);
  if (destW < 1) return;
  const destH = destW * (sprite.h / sprite.w);
  const destX = e.sx + e.scale * e.offset * ROAD.roadWidth * (width / 2) - destW / 2;
  const destY = e.sy - destH + e.bobY * destH * -6;

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, width, Math.max(0, e.clip));
  ctx.clip();
  // Purpose-built chevrons use hard pixel clusters; bilinear filtering turns
  // them back into the flat blurry boards they replaced.
  ctx.imageSmoothingEnabled = !e.sprite.startsWith('prop-chevron-');
  // Soft contact shadow under cars and pickups grounds them on the tarmac —
  // without it billboards read as floating cardboard. Scenery skips it (props
  // sit on painted verge and bake their own grounding).
  if (needsContactShadow(e.sprite)) {
    ctx.globalAlpha = 0.26;
    ctx.fillStyle = '#08131a';
    ctx.beginPath();
    ctx.ellipse(destX + destW / 2, e.sy, destW * 0.44, Math.max(1.5, destW * 0.07), 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  ctx.drawImage(sprite.canvas, destX, destY, destW, destH);
  ctx.restore();
}

/**
 * The speed rush: streaks raked radially OUT of the vanishing point, accelerating
 * as they fly toward the edges of the frame. Anchoring them to the vanishing
 * point (which itself swings with the camera yaw) is what makes them read as the
 * world tearing past you, rather than the flat horizontal ticks sliding down the
 * screen borders they replaced — those looked pasted on because they had no
 * relationship to the perspective they were drawn over.
 */
const STREAK_COUNT = 26;

function drawSpeedStreaks(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  vanishX: number,
  vanishY: number,
  speedPct: number,
  time: number,
): void {
  const reach = Math.hypot(width, height) * 0.75;
  ctx.save();
  ctx.lineCap = 'round';
  for (let i = 0; i < STREAK_COUNT; i += 1) {
    // A fixed fan of angles, biased away from dead-ahead so the streaks frame the
    // road rather than scribbling over the bit you are trying to look at.
    const angle = (i / STREAK_COUNT) * Math.PI * 2 + hash(i) * 0.4;
    const spin = Math.abs(Math.cos(angle)); // 0 straight up/down, 1 out to the sides
    if (spin < 0.25) continue;
    // Each streak's flight, cycled and offset so the fan never pulses in unison.
    const p = (time * (0.8 + speedPct * 1.9) + hash(i * 7.3)) % 1;
    // Quadratic ease: slow near the vanishing point, tearing past at the edges —
    // the same acceleration real scenery has as it comes at you.
    const near = p * p * reach * (0.35 + speedPct * 0.65);
    const len = (12 + speedPct * 90) * (0.35 + p);
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    ctx.globalAlpha = 0.5 * speedPct * Math.sin(p * Math.PI) * spin;
    ctx.lineWidth = 1 + speedPct * 2.2 * p;
    ctx.strokeStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(vanishX + cos * near, vanishY + sin * near);
    ctx.lineTo(vanishX + cos * (near + len), vanishY + sin * (near + len));
    ctx.stroke();
  }
  ctx.restore();
}

// Exposed for the title screen backdrop.
export function drawTitleArt(ctx: CanvasRenderingContext2D, w: number, h: number, art: SpriteImage): void {
  const scale = Math.max(w / art.w, h / art.h);
  const dw = art.w * scale;
  const dh = art.h * scale;
  ctx.drawImage(art.canvas, (w - dw) / 2, (h - dh) / 2, dw, dh);
}
