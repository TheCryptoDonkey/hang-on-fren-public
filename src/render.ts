// Renders the pseudo-3D scene: sky/sea/hills parallax, the projected road with
// distance fog, roadside scenery and dynamic entities (roses + traffic) with
// hill occlusion, then the rider on top. Pure drawing over already-updated
// state — all physics lives in road.ts / world.ts.

import { ROAD, RIDER_SCREEN_FRAC, project, findSegment } from './road.js';
import type { Track, Player, Segment } from './road.js';
import type { World } from './world.js';
import { signedForward } from './world.js';
import type { SpriteStore, SpriteImage } from './sprites.js';
import { DEFAULT_PALETTE, resolveScenerySprite, type Palette, type SceneryKit, type TimeOfDay } from './stages.js';
import { SPRITE_WORLD_WIDTH } from './geometry.js';
import { drawRider } from './rider.js';
import { clamp, lerp, wrap } from './util.js';

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
  horizon: number,
  curveShift: number,
  store: SpriteStore,
  tod: TimeOfDay | undefined,
  palette: Palette,
): boolean {
  const a = store.get(`horizon-${tod?.a ?? 'riviera'}`);
  const b = store.get(`horizon-${tod?.b ?? 'riviera'}`);
  if (!a || !b) return false;

  const draw = (img: SpriteImage, alpha: number): void => {
    if (alpha <= 0) return;
    const scale = (w / img.w) * 1.16; // cover width + a little parallax headroom
    const dw = img.w * scale;
    const dh = img.h * scale;
    const margin = (dw - w) / 2;
    const dx = -margin + clamp(-curveShift * 0.5, -margin, margin);
    const dy = horizon - BACKDROP_HORIZON_FRAC * dh; // align sea-horizon to road horizon
    ctx.globalAlpha = alpha;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(img.canvas, dx, dy, dw, dh);
  };
  // sky fill above the backdrop top, in case the road horizon sits low and the
  // scaled image doesn't quite reach y=0.
  ctx.fillStyle = palette.skyTop;
  ctx.fillRect(0, 0, w, Math.max(0, horizon));
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
  palette: Palette,
  time: number,
): void {
  const night = clamp(palette.star, 0, 1); // 0 = bright day … 1 = full night
  const seaTop = horizon - h * 0.13; // the shoreline: sea below it, mountains above

  // --- sky -------------------------------------------------------------------
  const sky = ctx.createLinearGradient(0, 0, 0, seaTop);
  sky.addColorStop(0, palette.skyTop);
  sky.addColorStop(1, palette.skyHorizon);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, seaTop + 2);

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
  const sunX = w * 0.68 - curveShift * 0.45;
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
    const shift = curveShift * parallax;
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
  ctx.fillRect(0, seaTop, w, horizon - seaTop + 2);

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
  drawCoastTown(ctx, w, h, seaTop, curveShift * 0.32, palette, night);

  // thin bright horizon line where sea meets the shore haze
  ctx.fillStyle = rgba(palette.fog, 0.5);
  ctx.fillRect(0, horizon - 1, w, 2);
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
}

export function renderScene(scene: Scene): void {
  const { ctx, width, height, track, player, world, store } = scene;
  const palette = scene.palette ?? DEFAULT_PALETTE;

  const baseSegment = findSegment(track, player.z);
  const basePercent = (player.z % ROAD.segmentLength) / ROAD.segmentLength;
  const playerY = lerp(baseSegment.p1.world.y, baseSegment.p2.world.y, basePercent);
  const cameraY = playerY + ROAD.cameraHeight;
  const cameraX = player.x * ROAD.roadWidth;

  // Project the road, accumulating the curve offset (x, dx) like Hang-On.
  let x = 0;
  let dx = -(baseSegment.curve * basePercent);
  let maxY = height;
  const drawn: Segment[] = [];

  for (let n = 0; n < ROAD.drawDistance; n += 1) {
    const seg = track.segments[(baseSegment.index + n) % track.segments.length];
    const looped = seg.index < baseSegment.index;
    const camZ = player.z - (looped ? track.length : 0);
    project(seg.p1, cameraX - x, cameraY, camZ, width, height, ROAD.roadWidth);
    project(seg.p2, cameraX - x - dx, cameraY, camZ, width, height, ROAD.roadWidth);
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
  // Primary path: the gpt-image Amalfi horizon backdrops, crossfaded by time of
  // day and scrolled for parallax. Falls back to the code-drawn seascape only if
  // the backdrop art isn't loaded.
  if (!drawHorizonArt(ctx, width, horizon, x * 0.02, store, scene.timeOfDay, palette)) {
    drawBackground(ctx, width, height, horizon, x * 0.02, palette, scene.time);
  }

  // Road, far to near so nearer segments overwrite fog on farther ones.
  for (let i = drawn.length - 1; i >= 0; i -= 1) {
    const seg = drawn[i];
    const n = (seg.index - baseSegment.index + track.segments.length) % track.segments.length;
    renderSegment(ctx, width, seg, n / ROAD.drawDistance, palette);
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

  // Rider — fixed near the bottom centre, bob with speed. Sized by HEIGHT so
  // the different lean frames never jump scale between poses. The screen
  // fraction is shared with road.ts (RIDER_FWD) so collision happens exactly
  // where the bike is drawn.
  const speedPct = player.speed / player.maxSpeed;
  const riderSize = Math.min(height * 0.3, width * 0.32);
  // Turbo exhaust flame — drawn under the rider so it licks out from behind the
  // rear wheel.
  if (scene.boost > 0 && scene.wipeout === 0) {
    drawBoostFlame(ctx, width / 2, height * RIDER_SCREEN_FRAC, riderSize, scene.time, scene.boost);
  }
  drawRider(ctx, store, {
    x: width / 2,
    y: height * RIDER_SCREEN_FRAC,
    size: riderSize,
    lean: player.lean,
    bob: Math.sin(scene.time * 26) * speedPct * 2.5,
    wipeout: scene.wipeout,
    spin: player.z * 0.03,
    speed: speedPct,
    time: scene.time,
  });

  // Speed streaks at the screen edges when moving fast — always in turbo or a
  // slingshot, and building as a draft charges so the wake FEELS like something.
  const streak = Math.max(speedPct, scene.boost, scene.sling ?? 0, (scene.draft ?? 0) * 0.8);
  if (streak > 0.5 && scene.wipeout === 0) drawSpeedStreaks(ctx, width, height, streak, scene.time);

  ctx.restore(); // end off-road shake transform

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

  // Fly-agaric trip: the whole frame's hues cycle hard, with a sliding rainbow
  // sheen over the top — unmistakably psychedelic, HUD still drawn clean above.
  const trip = scene.trip ?? 0;
  if (trip > 0) {
    const t = scene.time;
    ctx.save();
    ctx.globalCompositeOperation = 'hue';
    ctx.globalAlpha = 0.65 * trip;
    ctx.fillStyle = `hsl(${(t * 160) % 360}, 100%, 55%)`;
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

function renderSegment(ctx: CanvasRenderingContext2D, width: number, seg: Segment, fogT: number, palette: Palette): void {
  const p1 = seg.p1.screen;
  const p2 = seg.p2.screen;
  const dark = seg.color === 'dark';
  const grass = dark ? palette.grassDark : palette.grassLight;
  const road = dark ? palette.roadDark : palette.roadLight;
  const rumble = dark ? palette.rumbleDark : palette.rumbleLight;

  // grass slab spanning full width
  ctx.fillStyle = grass;
  ctx.fillRect(0, p2.y, width, p1.y - p2.y + 1);

  const r1 = rumbleWidth(p1.w);
  const r2 = rumbleWidth(p2.w);
  polygon(ctx, p1.x - p1.w - r1, p1.y, p1.x - p1.w, p1.y, p2.x - p2.w, p2.y, p2.x - p2.w - r2, p2.y, rumble);
  polygon(ctx, p1.x + p1.w + r1, p1.y, p1.x + p1.w, p1.y, p2.x + p2.w, p2.y, p2.x + p2.w + r2, p2.y, rumble);
  polygon(ctx, p1.x - p1.w, p1.y, p1.x + p1.w, p1.y, p2.x + p2.w, p2.y, p2.x - p2.w, p2.y, road);

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

  // distance fog
  const fog = 1 / Math.exp((fogT * fogT * ROAD.fogDensity));
  if (fog < 1) {
    ctx.globalAlpha = 1 - fog;
    ctx.fillStyle = palette.fog;
    ctx.fillRect(0, p2.y, width, p1.y - p2.y + 1);
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
  const worldW = SPRITE_WORLD_WIDTH[e.sprite] ?? 0.3;
  const destW = e.scale * worldW * ROAD.roadWidth * (width / 2);
  if (destW < 1) return;
  const destH = destW * (sprite.h / sprite.w);
  const destX = e.sx + e.scale * e.offset * ROAD.roadWidth * (width / 2) - destW / 2;
  const destY = e.sy - destH + e.bobY * destH * -6;

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, width, Math.max(0, e.clip));
  ctx.clip();
  ctx.imageSmoothingEnabled = true;
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

function drawSpeedStreaks(ctx: CanvasRenderingContext2D, width: number, height: number, speedPct: number, time: number): void {
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.5)';
  ctx.lineWidth = 2;
  const count = 7;
  for (let i = 0; i < count; i += 1) {
    const side = i % 2 === 0 ? 0 : 1;
    const p = (time * (2 + speedPct * 4) + i * 0.37) % 1;
    const edge = side === 0 ? lerp(width * 0.02, -width * 0.1, p) : lerp(width * 0.98, width * 1.1, p);
    const y = height * (0.5 + (i / count) * 0.45);
    const len = 40 + speedPct * 120 * p;
    ctx.globalAlpha = 0.5 * (1 - p);
    ctx.beginPath();
    ctx.moveTo(edge, y);
    ctx.lineTo(edge + (side === 0 ? -len : len), y);
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
