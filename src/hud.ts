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
  distanceM: number;
  roseStreak: number;
  level: number; // 1-based current level
  levels: number; // total levels in the journey
  region: string; // current region name
  shield: boolean; // HODL shield held (absorbs one wipeout)
  popups: Popup[];
}

export interface HudOptions {
  bottomInset?: number;
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
  const u = Math.hypot(w, h) / 1468;
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

  // --- speed (bottom-right) ---
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
    pill(ctx, 20 * u, 18 * u, shW, shH, PANEL);
    // mini shield glyph
    const gx = 38 * u;
    const gy = 35 * u;
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
    ctx.fillText('HODL', 56 * u, 41 * u);
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
