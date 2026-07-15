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
}

export interface HudOptions {
  bottomInset?: number;
  /** UI scale override (main.ts uiScale() — floored on touch devices so the
   *  labels stay readable on phones). Defaults to the raw diagonal scale. */
  scale?: number;
}

const PANEL = 'rgba(8, 26, 36, 0.72)';
const GOLD = '#ffd76b';
const MINT = '#8fe6c4';
const ROSE = '#ff5d78';

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

export function drawHud(ctx: CanvasRenderingContext2D, w: number, h: number, s: HudState, options: HudOptions = {}): void {
  // Diagonal-based scale so the HUD stays legible in portrait and landscape.
  const u = options.scale ?? Math.hypot(w, h) / 1468;
  const bottomInset = options.bottomInset ?? 0;
  ctx.textBaseline = 'alphabetic';

  // --- centre TIME ---
  const timeStr = Math.ceil(s.timeLeft).toString();
  const flash = s.urgency > 0 && Math.floor(performance.now() / 120) % 2 === 0;
  ctx.textAlign = 'center';
  ctx.font = `700 ${18 * u}px 'Trebuchet MS', sans-serif`;
  ctx.fillStyle = MINT;
  ctx.fillText('TIME', w / 2, 30 * u);
  ctx.font = `800 ${64 * u}px 'Trebuchet MS', sans-serif`;
  ctx.fillStyle = s.urgency > 0 ? (flash ? '#ff5252' : '#ffd0d0') : '#ffffff';
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.5)';
  ctx.shadowBlur = 8 * u;
  ctx.fillText(timeStr, w / 2, 92 * u);
  ctx.restore();

  // --- score / hi (right) ---
  ctx.textAlign = 'right';
  ctx.font = `700 ${18 * u}px 'Trebuchet MS', sans-serif`;
  ctx.fillStyle = GOLD;
  ctx.fillText('SCORE', w - 24 * u, 30 * u);
  ctx.font = `800 ${34 * u}px 'Trebuchet MS', sans-serif`;
  ctx.fillStyle = '#ffffff';
  ctx.fillText(Math.floor(s.score).toLocaleString('en-GB'), w - 24 * u, 64 * u);
  ctx.font = `700 ${15 * u}px 'Trebuchet MS', sans-serif`;
  ctx.fillStyle = MINT;
  ctx.fillText(`HI  ${Math.floor(s.hiScore).toLocaleString('en-GB')}`, w - 24 * u, 88 * u);

  // --- FREN FLOW (top-left) ---
  const flowX = 20 * u;
  const flowY = 18 * u;
  const flowW = Math.min(190 * u, w * 0.38);
  const flowH = 13 * u;
  ctx.textAlign = 'left';
  ctx.font = `800 ${14 * u}px 'Trebuchet MS', sans-serif`;
  ctx.fillStyle = GOLD;
  ctx.fillText(`FREN FLOW  ${s.flowLabel}`, flowX, flowY + 12 * u);
  ctx.textAlign = 'right';
  ctx.fillStyle = '#ffffff';
  ctx.fillText(`x${s.flowMultiplier.toFixed(2)}`, flowX + flowW, flowY + 12 * u);
  pill(ctx, flowX, flowY + 19 * u, flowW, flowH, PANEL);
  const fillW = Math.max(0, (flowW - 4 * u) * Math.min(100, Math.max(0, s.flowValue)) / 100);
  if (fillW > 0) {
    ctx.fillStyle = s.flowValue >= 90 ? GOLD : MINT;
    ctx.fillRect(flowX + 2 * u, flowY + 21 * u, fillW, flowH - 4 * u);
  }

  if (s.rivalGapM !== null) {
    ctx.textAlign = 'left';
    ctx.font = `800 ${14 * u}px 'Trebuchet MS', sans-serif`;
    ctx.fillStyle = s.rivalGapM >= 0 ? '#ff9b9b' : MINT;
    const gap = Math.round(Math.abs(s.rivalGapM));
    ctx.fillText(s.rivalGapM >= 0 ? `FREN  ▲ ${gap}m` : `YOU  ▲ ${gap}m`, flowX, flowY + 54 * u);
    ctx.fillStyle = 'rgba(255,255,255,0.72)';
    ctx.font = `700 ${11 * u}px 'Trebuchet MS', sans-serif`;
    ctx.fillText('SHOWDOWN  12.6 KM', flowX, flowY + 70 * u);
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
  ctx.textAlign = 'left';
  ctx.font = `800 ${15 * u}px 'Trebuchet MS', sans-serif`;
  ctx.fillStyle = GOLD;
  const lvLabel = `LV ${s.level}/${s.levels}`;
  ctx.fillText(lvLabel, 24 * u, markerY);
  const lvWidth = ctx.measureText(lvLabel).width;
  ctx.font = `700 ${15 * u}px 'Trebuchet MS', sans-serif`;
  ctx.fillStyle = MINT;
  ctx.fillText(s.region, 24 * u + lvWidth + 12 * u, markerY);

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
    const cardW = Math.min(w * 0.82, 620 * u);
    const cardH = 84 * u;
    const cardX = (w - cardW) / 2;
    const cardY = h * 0.17;
    pill(ctx, cardX, cardY, cardW, cardH, 'rgba(5,16,26,0.86)');
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
    ctx.textAlign = 'center';
    ctx.font = `800 ${16 * u}px 'Trebuchet MS', sans-serif`;
    ctx.fillStyle = ROSE;
    ctx.fillText(`ROSE x${s.roseStreak}`, w / 2, 118 * u);
  }

  // --- popups ---
  for (const p of s.popups) {
    const t = p.life / p.ttl;
    ctx.globalAlpha = Math.min(1, t * 1.6);
    ctx.textAlign = 'center';
    ctx.font = `800 ${24 * u}px 'Trebuchet MS', sans-serif`;
    ctx.fillStyle = p.color;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = 6 * u;
    ctx.fillText(p.text, p.x, p.y - (1 - t) * 40 * u);
    ctx.restore();
  }
  ctx.globalAlpha = 1;
}

export function addPopup(list: Popup[], text: string, x: number, y: number, color: string, ttl = 1.1): void {
  list.push({ text, x, y, life: ttl, ttl, color });
  if (list.length > 12) list.shift();
}

export function updatePopups(list: Popup[], dt: number): void {
  for (let i = list.length - 1; i >= 0; i -= 1) {
    list[i].life -= dt;
    if (list[i].life <= 0) list.splice(i, 1);
  }
}

export { formatTime };
