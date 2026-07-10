// Arcade "callsign" entry for the high-score screen. Works with a physical
// keyboard (type A–Z / 0–9, Backspace, Enter) AND an on-screen keyboard for
// touch, so it plays the same on a phone as on a desktop. Self-contained: the
// caller owns a single string value and forwards events here. Mirrors the
// neon-sentinel guest name picker (free text, blinking caret, tap-or-type).

export const NAME_MAX = 12;

const ROWS = ['1234567890', 'QWERTYUIOP', 'ASDFGHJKL', 'ZXCVBNM'] as const;

export type KeyAct = 'char' | 'space' | 'del' | 'ok';

export interface KeyRect {
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  ch?: string;
  act: KeyAct;
}

export interface NameLayout {
  rects: KeyRect[];
  boxX: number;
  boxY: number;
  boxW: number;
  boxH: number;
  promptY: number;
  hintY: number;
}

/** True for characters we accept into a callsign. */
export function isNameChar(ch: string): boolean {
  return ch.length === 1 && /^[A-Z0-9 ]$/i.test(ch);
}

export function appendChar(value: string, ch: string): string {
  if (value.length >= NAME_MAX || !isNameChar(ch)) return value;
  return value + ch.toUpperCase();
}

export function backspace(value: string): string {
  return value.slice(0, -1);
}

/** Trim to a clean callsign; blank falls back so the board never shows ''. */
export function cleanName(value: string): string {
  const clean = value
    .replace(/[^A-Z0-9 ]/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase()
    .slice(0, NAME_MAX)
    .trim();
  return clean || 'FRN';
}

/**
 * Lay out the name box + on-screen keyboard, anchored to the lower screen and
 * sized to fit BOTH the width and the remaining height, so it never overflows
 * in short landscape or narrow portrait. `u` is the game's diagonal UI scale.
 * `bottomInset` lifts the whole block clear of the screen's bottom edge — on
 * phones the last ~40px belong to the browser (Safari's tap-for-chrome zone
 * and the home indicator), so keys parked there feel dead.
 */
export function layout(W: number, H: number, u: number, bottomInset = 0): NameLayout {
  const cols = 10;
  const rowsN = ROWS.length;
  const actionRowsN = 1;
  const totalRows = rowsN + actionRowsN;
  const gap = Math.max(4, 7 * u);
  const vGap = Math.max(12, 18 * u); // box → keyboard
  const boxH = Math.max(40, 48 * u);
  const bottomMargin = Math.max(16, 26 * u) + bottomInset;

  const maxKbW = Math.min(W * 0.96, 660 * u);
  const keyByW = (maxKbW - gap * (cols - 1)) / cols;
  // Keep the whole block under the summary block (~top 46% of the screen).
  const vBudget = Math.max(120, H * 0.52 - bottomMargin);
  const keyByH = (vBudget - boxH - vGap - (totalRows - 1) * gap) / totalRows;
  const key = Math.max(18, Math.min(keyByW, keyByH));

  const blockH = boxH + vGap + totalRows * key + (totalRows - 1) * gap;
  const boxW = Math.min(W * 0.82, Math.max(260 * u, key * 6));
  const boxX = (W - boxW) / 2;
  const boxY = H - bottomMargin - blockH;
  const kbTop = boxY + boxH + vGap;

  const rects: KeyRect[] = [];
  ROWS.forEach((row, r) => {
    const chars = row.split('');
    const y = kbTop + r * (key + gap);
    const rowW = chars.length * key + (chars.length - 1) * gap;
    const x0 = (W - rowW) / 2;
    chars.forEach((ch, i) => {
      rects.push({ x: x0 + i * (key + gap), y, w: key, h: key, label: ch, ch, act: 'char' });
    });
  });

  const actionY = kbTop + rowsN * (key + gap);
  const topRowW = cols * key + (cols - 1) * gap;
  const spaceW = key * 4 + gap * 3;
  const actionW = (topRowW - spaceW - gap * 2) / 2;
  let actionX = (W - topRowW) / 2;
  rects.push({ x: actionX, y: actionY, w: spaceW, h: key, label: 'SPACE', ch: ' ', act: 'space' });
  actionX += spaceW + gap;
  rects.push({ x: actionX, y: actionY, w: actionW, h: key, label: 'BKSP', act: 'del' });
  actionX += actionW + gap;
  rects.push({ x: actionX, y: actionY, w: actionW, h: key, label: 'DONE', act: 'ok' });

  const promptY = boxY - Math.max(12, 16 * u);
  const hintY = actionY + key + Math.max(16, 22 * u);
  return { rects, boxX, boxY, boxW, boxH, promptY, hintY };
}

export function keyAt(rects: KeyRect[], x: number, y: number): KeyRect | null {
  for (const k of rects) {
    if (x >= k.x && x <= k.x + k.w && y >= k.y && y <= k.y + k.h) return k;
  }
  return null;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/** Draw the prompt, name box (with blinking caret) and the on-screen keyboard. */
export function drawNameEntry(
  ctx: CanvasRenderingContext2D,
  W: number,
  u: number,
  value: string,
  time: number,
  lay: NameLayout,
): void {
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';

  ctx.font = `800 ${22 * u}px 'Trebuchet MS', sans-serif`;
  ctx.fillStyle = '#ffd76b';
  ctx.fillText('NEW BEST RIDER — ENTER YOUR CALLSIGN', W / 2, lay.promptY);

  // name box
  roundRect(ctx, lay.boxX, lay.boxY, lay.boxW, lay.boxH, 8 * u);
  ctx.fillStyle = 'rgba(4,16,24,0.88)';
  ctx.fill();
  ctx.lineWidth = 2 * u;
  ctx.strokeStyle = 'rgba(255,215,107,0.9)';
  ctx.stroke();

  const caret = Math.floor(time * 2) % 2 === 0 && value.length < NAME_MAX ? '_' : '';
  ctx.textBaseline = 'middle';
  ctx.font = `900 ${Math.min(30 * u, lay.boxH * 0.6)}px monospace`;
  ctx.fillStyle = '#ffffff';
  ctx.fillText(value + caret || '_', W / 2, lay.boxY + lay.boxH / 2 + 2);

  // keys
  for (const k of lay.rects) {
    const accent = k.act === 'ok' ? '#8fe6c4' : k.act === 'del' ? '#ff8a8a' : '#ffe9c7';
    const fill = k.act === 'ok' ? 'rgba(143,230,196,0.16)' : k.act === 'del' ? 'rgba(255,120,120,0.14)' : 'rgba(6,20,28,0.82)';
    roundRect(ctx, k.x, k.y, k.w, k.h, 6 * u);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.lineWidth = 1.4 * u;
    ctx.strokeStyle = accent;
    ctx.globalAlpha = k.act === 'char' || k.act === 'space' ? 0.5 : 0.85;
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillStyle = accent;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `900 ${(k.act === 'char' ? 18 : 12) * u}px ${k.act === 'char' ? 'monospace' : "'Trebuchet MS', sans-serif"}`;
    ctx.fillText(k.label, k.x + k.w / 2, k.y + k.h / 2 + 1);
  }

  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'center';
  ctx.font = `600 ${13 * u}px 'Trebuchet MS', sans-serif`;
  ctx.fillStyle = 'rgba(255,255,255,0.72)';
  ctx.fillText('type or tap  ·  BKSP  ·  DONE / Enter to confirm', W / 2, lay.hintY);
}
