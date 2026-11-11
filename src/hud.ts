// The in-play HUD: big centre TIME, SCORE + HI right, speed bottom-right,
// distance/district marker, and transient rose / combo / overtake popups. Drawn
// over the scene each frame. (There are no lives — the clock is the only limit.)

import { formatTime } from './util.js';

export interface Popup {
  text: string;
  x: number;
  y: number;
  life: number; // seconds remaining
  ttl: number;
  color: string;
  // Layout state, owned by placePopups (callers never set these). A popup is
  // placed once, into a row of its own, and keeps that row for its whole life.
  px?: number; // font size in buffer px (shrunk if the text would not fit the width)
  wid?: number; // text advance width at px
  lx?: number; // placed centre x
  ly?: number; // placed baseline y at age 0; undefined until it has a free row
  held?: boolean; // no free row yet: waits unticked rather than overprinting
  lw?: number; // buffer size and scale the placement was made for
  lh?: number;
  lu?: number;
  sprite?: TextSprite; // outlined text, rendered once
}

export interface HudState {
  score: number;
  hiScore: number;
  timeLeft: number;
  urgency: number; // 0..1
  speedKph: number;
  gear: number; // 1-based
  distanceM: number;
  roseStreak: number;
  level: number; // 1-based current level
  levels: number; // total levels in the journey
  region: string; // current region name
  shield: boolean; // HODL shield held (absorbs one wipeout)
  drifting: boolean;
  driftSlip: number; // 0..1 how far the slide is hung out — how close to spinning
  driftPoints: number; // what the slide would pay if caught RIGHT NOW
  flowValue: number;
  flowLabel: string;
  flowMultiplier: number;
  /** Positive means the Fren is ahead; null after the opening showdown. */
  rivalGapM: number | null;
  rivalIntro: number;
  rivalResult: { won: boolean; deltaS: number } | null;
  rivalResultTime: number;
  popups: Popup[];
  /** The one large banner (WIPEOUT, TURBO!), or null. Drawn centred, over the popups. */
  banner?: Banner | null;
}

export interface HudOptions {
  bottomInset?: number;
  /** UI scale override (main.ts uiScale() — floored on touch devices so the
   *  labels stay readable on phones). Defaults to the raw diagonal scale. */
  scale?: number;
  /** Extra areas, in canvas px, that popups must stay out of (DOM controls
   *  drawn over the canvas, such as the touch pause button). */
  keepOut?: readonly Rect[];
}

const PANEL = 'rgba(8, 26, 36, 0.72)';
const GOLD = '#ffd76b';
const MINT = '#8fe6c4';
const ROSE = '#ff5d78';
const OUTLINE = 'rgba(4, 12, 18, 0.92)'; // same dark round-join stroke the title and end screens use
const FACE = "'Trebuchet MS', sans-serif";

// --- outlined text ------------------------------------------------------------
//
// HUD text floats straight over the scenery, so it carries a dark outline to
// stay readable over sky, sand and snow. Stroking text is the expensive part
// (and a blurred shadow is worse), so nothing here strokes every frame unless it has
// to: each label is rendered ONCE into a tight offscreen sprite and blitted, and
// is re-rendered only when its text, font or colour changes (a new scale after a
// resize changes the font, so that re-bakes too). Only the two values that
// change almost every frame (the score and the showdown gap) are stroked live.

/** Outlined text rendered once into a tight canvas, padded by the stroke width. */
export interface TextSprite {
  key: string;
  canvas: HTMLCanvasElement;
  adv: number; // text advance width — what alignment is measured against
  ox: number; // x of the text origin inside the canvas
  oy: number; // y of the baseline inside the canvas
}

let measureCtx: CanvasRenderingContext2D | null = null;

function outlineWidth(px: number, u: number): number {
  return 2.2 * u + px * 0.1;
}

function makeSprite(key: string, text: string, font: string, px: number, fill: string, lw: number): TextSprite | null {
  if (typeof document === 'undefined') return null; // unit tests / no DOM
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
  if (!measureCtx) return null;
  measureCtx.font = font;
  const adv = measureCtx.measureText(text).width;
  const pad = Math.ceil(lw / 2) + 2;
  const asc = Math.ceil(px * 1.0);
  const desc = Math.ceil(px * 0.3);
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(adv) + pad * 2;
  canvas.height = asc + desc + pad * 2;
  const g = canvas.getContext('2d');
  if (!g) return null;
  g.font = font; // sizing the canvas reset its state
  g.textAlign = 'left';
  g.textBaseline = 'alphabetic';
  g.lineJoin = 'round';
  g.lineWidth = lw;
  g.strokeStyle = OUTLINE;
  g.strokeText(text, pad, pad + asc);
  g.fillStyle = fill;
  g.fillText(text, pad, pad + asc);
  return { key, canvas, adv, ox: pad, oy: pad + asc };
}

function blit(ctx: CanvasRenderingContext2D, spr: TextSprite, align: CanvasTextAlign, x: number, y: number, alpha: number): void {
  const left = align === 'right' ? x - spr.adv : align === 'center' ? x - spr.adv / 2 : x;
  // Integer destination: a fractional blit would resample (soften) the sprite.
  if (alpha !== 1) ctx.globalAlpha = alpha;
  ctx.drawImage(spr.canvas, Math.round(left - spr.ox), Math.round(y - spr.oy));
  if (alpha !== 1) ctx.globalAlpha = 1;
}

/** Stroke + fill straight onto the canvas. For values that change every frame
 *  (a cached sprite would just be rebuilt every frame) and as the no-DOM fallback. */
function liveOutlined(
  ctx: CanvasRenderingContext2D, text: string, font: string, fill: string, lw: number,
  align: CanvasTextAlign, x: number, y: number, alpha = 1,
): void {
  ctx.save();
  ctx.font = font;
  ctx.textAlign = align;
  ctx.globalAlpha = alpha;
  ctx.lineJoin = 'round';
  ctx.lineWidth = lw;
  ctx.strokeStyle = OUTLINE;
  ctx.strokeText(text, x, y);
  ctx.fillStyle = fill;
  ctx.fillText(text, x, y);
  ctx.restore();
}

// One cached sprite per named slot: a slot re-bakes only when its key changes.
const slots = new Map<string, TextSprite>();

/** Draw outlined text from a named slot's cache; returns its advance width.
 *  `alpha` is applied at blit time so the baked colours stay opaque. */
function label(
  ctx: CanvasRenderingContext2D, slot: string, text: string, weight: number, px: number, fill: string,
  align: CanvasTextAlign, x: number, y: number, u: number, alpha = 1,
): number {
  const font = `${weight} ${px}px ${FACE}`;
  const lw = outlineWidth(px, u);
  const key = `${text}|${font}|${fill}|${lw}`;
  let spr = slots.get(slot);
  if (!spr || spr.key !== key) {
    spr = makeSprite(key, text, font, px, fill, lw) ?? undefined;
    if (spr) slots.set(slot, spr);
    else slots.delete(slot);
  }
  if (!spr) { // no DOM to bake into: stroke live
    liveOutlined(ctx, text, font, fill, lw, align, x, y, alpha);
    ctx.font = font;
    return ctx.measureText(text).width;
  }
  blit(ctx, spr, align, x, y, alpha);
  return spr.adv;
}

// --- popups -------------------------------------------------------------------
//
// Popups are placed, not just drawn: every popup gets a row of its own that no
// other popup and no HUD readout occupies, and keeps it for its whole life, so
// a burst (the checkpoint block, a rose + overtake + flow-tier pile-up) reads
// as a stack instead of one smear. All popups float up at the same speed, so
// rows placed apart stay apart. If its column has no free row the popup steps
// sideways into a free one; only if the whole screen is full does it wait (its
// clock held) until a row frees up: every message still shows.

export interface Rect { x0: number; y0: number; x1: number; y1: number }

export interface PopupEnv {
  w: number;
  h: number;
  u: number;
  /** Screen areas the popups must stay out of (HUD readouts, cards). */
  zones: readonly Rect[];
  /** Text advance width at the given font size. */
  measure: (text: string, px: number) => number;
}

/** Popup font size, in HUD units (× u). */
export const POPUP_SIZE = 24;
/** Shared float speed, HUD units per second. */
export const POPUP_RISE = 10;
const ASC = 0.8; // glyph height above the baseline, plus outline, in em
const DESC = 0.28; // …and below it
const ROW = 1.2; // baseline-to-baseline distance of stacked rows, in em
const SIDE_GAP = 16; // horizontal clearance between popups sharing a row, × u: wide enough that neighbours read as two messages

/** The baseline the popup is drawn at, `age` seconds into its life. */
export function popupY(p: Popup, u: number): number {
  return (p.ly ?? p.y) - POPUP_RISE * u * (p.ttl - p.life);
}

function placedFor(p: Popup, w: number, h: number, u: number): boolean {
  return p.ly !== undefined && p.lw === w && p.lh === h && p.lu === u;
}

function fits(p: Popup, c: number, others: Popup[], env: PopupEnv): boolean {
  const { u, h, zones } = env;
  const px = p.px as number;
  const wid = p.wid as number;
  const rem = POPUP_RISE * u * p.life; // how much further it will float
  const top = c - rem - ASC * px;
  const bottom = c + DESC * px;
  if (top < 4 * u || bottom > h - 4 * u) return false;
  const x0 = (p.lx as number) - wid / 2;
  const x1 = (p.lx as number) + wid / 2;
  for (const z of zones) {
    if (x1 > z.x0 && x0 < z.x1 && bottom > z.y0 && top < z.y1) return false;
  }
  for (const q of others) {
    const qpx = q.px as number;
    if (Math.abs((q.lx as number) - (p.lx as number)) >= (wid + (q.wid as number)) / 2 + SIDE_GAP * u) continue;
    if (Math.abs(c - popupY(q, u)) < ROW * Math.max(px, qpx) - 0.5) return false;
  }
  return true;
}

/**
 * Give every unplaced popup a row. Cheap when nothing is new (one pass over a
 * handful of popups), and the only per-popup work that measures text.
 */
export function placePopups(list: Popup[], env: PopupEnv): void {
  const { w, u } = env;
  for (const p of list) {
    if (placedFor(p, env.w, env.h, env.u)) continue;
    p.ly = undefined;
    let px = POPUP_SIZE * u;
    let wid = env.measure(p.text, px);
    const maxW = w - 24 * u;
    if (wid > maxW) { // a long line on a narrow screen: shrink it to fit rather than clip
      px *= maxW / wid;
      wid = maxW;
    }
    p.px = px;
    p.wid = wid;
    p.lx = Math.min(Math.max(p.x, wid / 2 + 12 * u), Math.max(wid / 2 + 12 * u, w - wid / 2 - 12 * u));
    const age = p.ttl - p.life;
    const others = list.filter(q => q !== p && placedFor(q, env.w, env.h, env.u));
    // Candidate baselines (as drawn now): the asked-for spot, then just clear of
    // each obstacle. Take the nearest that fits, preferring to sit below.
    const rem = POPUP_RISE * u * p.life;
    const cands = [p.y - POPUP_RISE * u * age, rem + ASC * px + 4 * u, env.h - DESC * px - 4 * u];
    for (const z of env.zones) {
      cands.push(z.y1 + rem + ASC * px + 0.5, z.y0 - DESC * px - 0.5);
    }
    for (const q of others) {
      cands.push(popupY(q, u) + ROW * Math.max(px, q.px as number), popupY(q, u) - ROW * Math.max(px, q.px as number));
    }
    const want = p.y - POPUP_RISE * u * age;
    const home = p.lx;
    let best = Number.NaN;
    let bestCost = Infinity;
    let bestX = home;
    const tryColumn = (lx: number, shift: number): void => {
      p.lx = lx;
      for (const c of cands) {
        const cost = (c >= want ? c - want : (want - c) * 1.5) + shift;
        if (cost < bestCost && fits(p, c, others, env)) {
          best = c;
          bestCost = cost;
          bestX = lx;
        }
      }
    };
    tryColumn(home, 0);
    if (bestCost === Infinity) {
      // Its own column is full (a checkpoint block on a short phone screen fills
      // it for a second or two). Step sideways, just clear of a popup already
      // there, rather than show the message late.
      const lo = wid / 2 + 12 * u;
      const hi = w - wid / 2 - 12 * u;
      for (const q of others) {
        const gap = (wid + (q.wid as number)) / 2 + SIDE_GAP * u + 0.5;
        for (const lx of [(q.lx as number) - gap, (q.lx as number) + gap]) {
          if (lx >= lo && lx <= hi) tryColumn(lx, Math.abs(lx - home));
        }
      }
    }
    p.lx = bestX;
    if (bestCost === Infinity) {
      p.held = true;
      continue;
    }
    p.held = false;
    p.ly = best + POPUP_RISE * u * age;
    p.lw = env.w;
    p.lh = env.h;
    p.lu = env.u;
  }
}

// --- banners ------------------------------------------------------------------
//
// A banner is the HUD's big one-line announcement: a wipeout or a turbo needs to
// land harder than a 24-unit popup. There is one slot, drawn centred, baked once
// into a sprite and faded at blit time (re-baking a stroked sprite every frame to
// animate its size would cost far more than the effect is worth).

export interface Banner {
  text: string;
  color: string;
  /** Font size, in HUD units (× u). */
  size: number;
  /** Glyph centre as a fraction of the buffer height. */
  y: number;
  life: number; // seconds remaining
  ttl: number;
  /** A banner only replaces one of equal or lower priority. */
  priority: number;
}

export const BANNER_KINDS = {
  wipeout: { size: 72, y: 0.42, ttl: 1.1, priority: 2 },
} as const;

/** Build a banner of a kind. */
export function makeBanner(kind: keyof typeof BANNER_KINDS, text: string, color: string): Banner {
  const k = BANNER_KINDS[kind];
  return { text, color, size: k.size, y: k.y, life: k.ttl, ttl: k.ttl, priority: k.priority };
}

/** The slot after offering it `next`: a live banner of higher priority keeps it. */
export function offerBanner(current: Banner | null, next: Banner): Banner | null {
  return current && current.life > 0 && current.priority > next.priority ? current : next;
}

/** Age a banner; null once it has run out. */
export function tickBanner(b: Banner | null, dt: number): Banner | null {
  if (!b) return null;
  b.life -= dt;
  return b.life > 0 ? b : null;
}

/** Full strength for the first part of its life, then a clean fade to nothing. */
export function bannerAlpha(b: Banner): number {
  return Math.max(0, Math.min(1, b.life / (b.ttl * 0.45)));
}

/** Where a banner prints. `x` is its centre, `y` its baseline. */
export interface BannerLayout { px: number; x: number; y: number; wid: number }

/**
 * Lay a banner out: centred, shrunk to fit the width left by anything in
 * `keepOut` that shares its rows (the touch pause button), held below the TIME
 * readout, and moved clear of `avoid` (the rival card), which it never overprints.
 */
export function bannerLayout(
  w: number, h: number, u: number, b: Pick<Banner, 'text' | 'size' | 'y'>,
  measure: (text: string, px: number) => number,
  keepOut: readonly Rect[] = [], avoid: readonly Rect[] = [],
): BannerLayout {
  let px = Math.round(b.size * u);
  let base = Math.max(b.y * h + 0.26 * px, 132 * u + ASC * px);
  const room = (size: number, y: number): number => {
    let maxW = w * 0.92;
    for (const z of keepOut) {
      if (z.y1 <= y - ASC * size || z.y0 >= y + DESC * size) continue;
      if (z.x0 >= w / 2) maxW = Math.min(maxW, 2 * (z.x0 - w / 2));
      else if (z.x1 <= w / 2) maxW = Math.min(maxW, 2 * (w / 2 - z.x1));
    }
    return Math.max(0, maxW);
  };
  const gap = 6 * u;
  for (const r of avoid) {
    if (r.x1 <= w * 0.04 || r.x0 >= w * 0.96) continue;
    if (r.y1 <= base - ASC * px || r.y0 >= base + DESC * px) continue;
    const below = r.y1 + gap + ASC * px;
    base = below + DESC * px <= h * 0.94 ? below : r.y0 - gap - DESC * px;
  }
  for (let pass = 0; pass < 2; pass += 1) {
    const wid = measure(b.text, px);
    const maxW = room(px, base);
    if (wid > maxW && wid > 0) px = Math.max(8, Math.floor(px * maxW / wid));
  }
  return { px, x: w / 2, y: base, wid: measure(b.text, px) };
}

function pill(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, fill: string): void {
  const r = h / 2;
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
  ctx.fill();
}

/** Top of the rival card: 17% down, but never over the TIME digits and rose
 *  streak, which reach 126u and on a short phone screen come further down than that. */
export function rivalCardY(h: number, u: number): number {
  return Math.max(h * 0.17, 130 * u);
}

/** The rival card: centred, and narrowed on a small screen so it stops short of
 *  anything in `keepOut` that shares its rows (the touch pause button). */
export function rivalCardRect(w: number, h: number, u: number, keepOut: readonly Rect[] = []): { x: number; y: number; w: number; h: number } {
  const y = rivalCardY(h, u);
  const cardH = 84 * u;
  let cardW = Math.min(w * 0.82, 620 * u);
  for (const z of keepOut) {
    if (z.y1 <= y || z.y0 >= y + cardH) continue;
    if (z.x0 >= w / 2) cardW = Math.min(cardW, 2 * (z.x0 - w / 2));
    else if (z.x1 <= w / 2) cardW = Math.min(cardW, 2 * (w / 2 - z.x1));
  }
  return { x: (w - cardW) / 2, y, w: cardW, h: cardH };
}

export function drawHud(ctx: CanvasRenderingContext2D, w: number, h: number, s: HudState, options: HudOptions = {}): void {
  // Diagonal-based scale so the HUD stays legible in portrait and landscape.
  const u = options.scale ?? Math.hypot(w, h) / 1468;
  const bottomInset = options.bottomInset ?? 0;
  ctx.textBaseline = 'alphabetic';

  // --- centre TIME ---
  const timeStr = Math.ceil(s.timeLeft).toString();
  const flash = s.urgency > 0 && Math.floor(performance.now() / 120) % 2 === 0;
  // (Outlined text from here on: baked labels via label(), see above.)
  const timeColour = s.urgency > 0 ? (flash ? '#ff5252' : '#ffd0d0') : '#ffffff';
  label(ctx, 'time-label', 'TIME', 700, 18 * u, MINT, 'center', w / 2, 30 * u, u);
  label(ctx, `time:${timeColour}`, timeStr, 800, 64 * u, timeColour, 'center', w / 2, 92 * u, u);

  // --- score / hi (right) ---
  label(ctx, 'score-label', 'SCORE', 700, 18 * u, GOLD, 'right', w - 24 * u, 30 * u, u);
  // The score moves nearly every frame, so a cached sprite would only be
  // rebuilt every frame: this one value is stroked live.
  liveOutlined(
    ctx, Math.floor(s.score).toLocaleString('en-GB'), `800 ${34 * u}px ${FACE}`, '#ffffff',
    outlineWidth(34 * u, u), 'right', w - 24 * u, 64 * u,
  );
  label(ctx, 'hi', `HI  ${Math.floor(s.hiScore).toLocaleString('en-GB')}`, 700, 15 * u, MINT, 'right', w - 24 * u, 88 * u, u);

  // --- FREN FLOW (top-left) ---
  const flowX = 20 * u;
  const flowY = 18 * u;
  const flowW = Math.min(190 * u, w * 0.38);
  const flowH = 13 * u;
  label(ctx, 'flow', `FREN FLOW  ${s.flowLabel}`, 800, 14 * u, GOLD, 'left', flowX, flowY + 12 * u, u);
  label(ctx, 'flow-x', `x${s.flowMultiplier.toFixed(2)}`, 800, 14 * u, '#ffffff', 'right', flowX + flowW, flowY + 12 * u, u);
  pill(ctx, flowX, flowY + 19 * u, flowW, flowH, PANEL);
  const fillW = Math.max(0, (flowW - 4 * u) * Math.min(100, Math.max(0, s.flowValue)) / 100);
  if (fillW > 0) {
    ctx.fillStyle = s.flowValue >= 90 ? GOLD : MINT;
    ctx.fillRect(flowX + 2 * u, flowY + 21 * u, fillW, flowH - 4 * u);
  }

  if (s.rivalGapM !== null) {
    const gap = Math.round(Math.abs(s.rivalGapM));
    liveOutlined( // live for the same reason as the score: it counts down the metres
      ctx, s.rivalGapM >= 0 ? `FREN  ▲ ${gap}m` : `YOU  ▲ ${gap}m`, `800 ${14 * u}px ${FACE}`,
      s.rivalGapM >= 0 ? '#ff9b9b' : MINT, outlineWidth(14 * u, u), 'left', flowX, flowY + 54 * u,
    );
    // Baked opaque and faded at blit time: the same 72% white, with a clean outline.
    label(ctx, 'showdown', 'SHOWDOWN  12.6 KM', 700, 11 * u, '#ffffff', 'left', flowX, flowY + 70 * u, u, 0.72);
  }

  // --- speed + gear (bottom-right) ---
  const spW = 150 * u;
  const spH = 40 * u;
  const spX = w - spW - 20 * u;
  const spY = h - bottomInset - spH - 20 * u;
  pill(ctx, spX, spY, spW, spH, PANEL);
  ctx.textAlign = 'left';
  ctx.font = `800 ${26 * u}px 'Trebuchet MS', sans-serif`;
  ctx.fillStyle = '#ffffff';
  ctx.fillText(`${Math.round(s.speedKph)}`, spX + 16 * u, spY + 29 * u);
  ctx.font = `700 ${13 * u}px 'Trebuchet MS', sans-serif`;
  ctx.fillStyle = MINT;
  ctx.fillText('KM/H', spX + 66 * u, spY + 28 * u);
  // The gear the box is actually in — the visual half of the engine's ladder.
  ctx.textAlign = 'right';
  ctx.font = `900 ${28 * u}px 'Trebuchet MS', sans-serif`;
  ctx.fillStyle = GOLD;
  ctx.fillText(`${s.gear}`, spX + spW - 16 * u, spY + 30 * u);

  // --- drift meter: the points you are gambling with RIGHT NOW ---------------
  // Only up while sideways. The bar is how far the slide is hung out, so it fills
  // toward red as you approach the angle that spins it — the rider can see the
  // bet growing and the risk growing in the same glance, which is the entire
  // decision the powerslide asks them to make.
  if (s.drifting && s.driftPoints > 0) {
    const dW = 220 * u;
    const dH = 30 * u;
    const dX = (w - dW) / 2;
    const dY = h - bottomInset - dH - 26 * u;
    pill(ctx, dX, dY, dW, dH, PANEL);
    const fill = Math.min(1, s.driftSlip);
    const hot = fill > 0.8; // about to let go
    const barColour = hot && Math.floor(performance.now() / 90) % 2 === 0
      ? '#ff5252'
      : (fill > 0.6 ? GOLD : '#8fd0ff');
    pill(ctx, dX + 4 * u, dY + dH - 8 * u, (dW - 8 * u) * fill, 4 * u, barColour);
    ctx.textAlign = 'center';
    ctx.font = `800 ${17 * u}px 'Trebuchet MS', sans-serif`;
    ctx.fillStyle = hot ? '#ff9d9d' : '#8fd0ff';
    ctx.fillText(`DRIFT  +${s.driftPoints.toLocaleString('en-GB')}`, w / 2, dY + 19 * u);
  }

  // --- level / region marker (bottom-left, above the distance pill) ---
  const markerY = h - bottomInset - spH - 34 * u;
  const lvWidth = label(ctx, 'lv', `LV ${s.level}/${s.levels}`, 800, 15 * u, GOLD, 'left', 24 * u, markerY, u);
  const regionWidth = label(ctx, 'region', s.region, 700, 15 * u, MINT, 'left', 24 * u + lvWidth + 12 * u, markerY, u);

  // --- distance (bottom-left) ---
  const distanceY = h - bottomInset - spH - 20 * u;
  pill(ctx, 20 * u, distanceY, 160 * u, spH, PANEL);
  ctx.textAlign = 'left';
  ctx.font = `800 ${22 * u}px 'Trebuchet MS', sans-serif`;
  ctx.fillStyle = '#ffffff';
  ctx.fillText(`${(s.distanceM / 1000).toFixed(2)}`, 34 * u, distanceY + 28 * u);
  ctx.font = `700 ${13 * u}px 'Trebuchet MS', sans-serif`;
  ctx.fillStyle = GOLD;
  ctx.fillText('KM', 34 * u + 70 * u, distanceY + 26 * u);

  // --- HODL shield badge (top-left, only while held) ---
  if (s.shield) {
    const shW = 118 * u;
    const shH = 34 * u;
    const shY = (s.rivalGapM !== null ? 103 : 62) * u;
    pill(ctx, 20 * u, shY, shW, shH, PANEL);
    // mini shield glyph
    const gx = 38 * u;
    const gy = shY + shH / 2;
    const gs = 11 * u;
    ctx.beginPath();
    ctx.moveTo(gx, gy - gs);
    ctx.quadraticCurveTo(gx + gs, gy - gs * 0.7, gx + gs, gy - gs * 0.55);
    ctx.quadraticCurveTo(gx + gs, gy + gs * 0.35, gx, gy + gs);
    ctx.quadraticCurveTo(gx - gs, gy + gs * 0.35, gx - gs, gy - gs * 0.55);
    ctx.quadraticCurveTo(gx - gs, gy - gs * 0.7, gx, gy - gs);
    ctx.closePath();
    ctx.fillStyle = '#8fd0ff';
    ctx.fill();
    ctx.textAlign = 'left';
    ctx.font = `800 ${16 * u}px 'Trebuchet MS', sans-serif`;
    ctx.fillStyle = GOLD;
    ctx.fillText('HODL', 56 * u, shY + 23 * u);
  }

  // Rival introduction/result cards are authored beats, not ordinary popups.
  if (s.rivalIntro > 0 || (s.rivalResult && s.rivalResultTime > 0)) {
    const result = s.rivalResult && s.rivalResultTime > 0 ? s.rivalResult : null;
    const card = rivalCardRect(w, h, u, options.keepOut);
    const cardY = card.y;
    pill(ctx, card.x, card.y, card.w, card.h, 'rgba(5,16,26,0.86)');
    ctx.textAlign = 'center';
    ctx.font = `900 ${25 * u}px 'Trebuchet MS', sans-serif`;
    ctx.fillStyle = result ? (result.won ? GOLD : '#ff8a8a') : GOLD;
    ctx.fillText(
      result ? (result.won ? 'FREN RIVAL BEATEN!' : 'THE FREN TAKES IT!') : 'FREN RIVAL TOUR',
      w / 2,
      cardY + 34 * u,
    );
    ctx.font = `800 ${15 * u}px 'Trebuchet MS', sans-serif`;
    ctx.fillStyle = '#ffffff';
    const detail = result
      ? result.won
        ? `YOU WIN BY ${result.deltaS.toFixed(1)}s  ·  +3,000`
        : `FREN WINS BY ${result.deltaS.toFixed(1)}s  ·  GRAND TOUR CONTINUES`
      : 'BEAT THE RED-HELMET RIDER TO 12.6 KM';
    ctx.fillText(detail, w / 2, cardY + 61 * u);
  }

  // rose streak flag
  if (s.roseStreak > 1) {
    label(ctx, 'rose', `ROSE x${s.roseStreak}`, 800, 16 * u, ROSE, 'center', w / 2, 118 * u, u);
  }

  // --- banner layout (before the popups, which keep out of it) ---
  const banner = s.banner && s.banner.life > 0 ? s.banner : null;
  const cardUp = s.rivalIntro > 0 || (s.rivalResult && s.rivalResultTime > 0);
  let bannerBox: BannerLayout | null = null;
  if (banner) {
    const avoid: Rect[] = [];
    if (cardUp) {
      const card = rivalCardRect(w, h, u, options.keepOut);
      avoid.push({ x0: card.x, y0: card.y, x1: card.x + card.w, y1: card.y + card.h });
    }
    bannerBox = bannerLayout(w, h, u, banner, (text, px) => {
      ctx.font = `900 ${px}px ${FACE}`;
      return ctx.measureText(text).width;
    }, options.keepOut, avoid);
  }

  // --- popups ---
  if (s.popups.length > 0) {
    ctx.textAlign = 'center';
    // The readouts a popup must not print over, wherever it asked to appear.
    // Built only on a frame that actually has a popup to place.
    if (s.popups.some(p => !placedFor(p, w, h, u))) {
      const m = 6 * u;
      const zones: Rect[] = [
        // centre TIME + ROSE streak (reserved even when the streak is off)
        { x0: w / 2 - 74 * u, y0: 6 * u, x1: w / 2 + 74 * u, y1: 126 * u },
        // SCORE / HI
        { x0: w - 24 * u - 200 * u, y0: 6 * u, x1: w, y1: 96 * u },
        // FREN FLOW + showdown gap + HODL shield badge
        { x0: 0, y0: 6 * u, x1: flowX + flowW + 40 * u, y1: (s.shield ? (s.rivalGapM !== null ? 137 : 96) : (s.rivalGapM !== null ? 88 : 62)) * u },
        // level / region marker + distance pill
        { x0: 0, y0: markerY - 17 * u, x1: Math.max(180 * u, 24 * u + lvWidth + 12 * u + regionWidth) + m, y1: h },
        // speed pill
        { x0: spX - m, y0: spY - m, x1: w, y1: h },
        // drift meter (reserved even when not drifting)
        { x0: (w - 220 * u) / 2 - m, y0: h - bottomInset - 30 * u - 26 * u - m, x1: (w + 220 * u) / 2 + m, y1: h },
      ];
      if (s.rivalIntro > 0 || (s.rivalResult && s.rivalResultTime > 0)) {
        const card = rivalCardRect(w, h, u, options.keepOut);
        zones.push({ x0: card.x - m, y0: card.y - m, x1: card.x + card.w + m, y1: card.y + card.h + m });
      }
      if (options.keepOut) zones.push(...options.keepOut);
      if (bannerBox) {
        zones.push({ x0: bannerBox.x - bannerBox.wid / 2 - m, y0: bannerBox.y - ASC * bannerBox.px - m, x1: bannerBox.x + bannerBox.wid / 2 + m, y1: bannerBox.y + DESC * bannerBox.px + m });
      }
      placePopups(s.popups, env(ctx, w, h, u, zones));
    }
    for (const p of s.popups) {
      if (p.ly === undefined || p.held) continue;
      const px = p.px as number;
      const font = `800 ${px}px ${FACE}`;
      const lw = outlineWidth(px, u);
      const key = `${p.text}|${font}|${p.color}|${lw}`;
      if (!p.sprite || p.sprite.key !== key) p.sprite = makeSprite(key, p.text, font, px, p.color, lw) ?? undefined;
      const alpha = Math.min(1, (p.life / p.ttl) * 1.6);
      const y = popupY(p, u);
      if (p.sprite) blit(ctx, p.sprite, 'center', p.lx as number, y, alpha);
      else liveOutlined(ctx, p.text, font, p.color, lw, 'center', p.lx as number, y, alpha);
    }
  }
  if (banner && bannerBox) {
    ctx.textAlign = 'center';
    label(ctx, 'banner', banner.text, 900, bannerBox.px, banner.color, 'center', bannerBox.x, bannerBox.y, u, bannerAlpha(banner));
  }
  ctx.globalAlpha = 1;
}

function env(ctx: CanvasRenderingContext2D, w: number, h: number, u: number, zones: readonly Rect[]): PopupEnv {
  return {
    w, h, u, zones,
    measure: (text, px) => {
      ctx.font = `800 ${px}px ${FACE}`;
      return ctx.measureText(text).width;
    },
  };
}

export function addPopup(list: Popup[], text: string, x: number, y: number, color: string, ttl = 1.1): void {
  list.push({ text, x, y, life: ttl, ttl, color });
  if (list.length > 12) {
    // Drop the oldest popup that has been placed (so has been on screen); one
    // still waiting for a row, or not yet drawn, has not been read, so it goes
    // only when every popup is in that state.
    const shown = list.findIndex((q) => q.ly !== undefined && !q.held);
    list.splice(shown === -1 ? 0 : shown, 1);
  }
}

export function updatePopups(list: Popup[], dt: number): void {
  for (let i = list.length - 1; i >= 0; i -= 1) {
    if (list[i].held) continue; // still waiting for a free row: its clock has not started
    list[i].life -= dt;
    if (list[i].life <= 0) list.splice(i, 1);
  }
}

export { formatTime };
