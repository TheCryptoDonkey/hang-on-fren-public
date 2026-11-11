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
  /** Font sizes (canvas px) so the drawing follows the fitted layout. */
  promptPx: number;
  hintPx: number;
  charPx: number;
  actPx: number;
  boxPx: number;
  /** Top of the prompt's ink: the summary above must end before this. */
  promptTop: number;
  /** Chrome scale (<= 1) applied to radii and line widths. */
  chrome: number;
}

export const PROMPT_TEXT = 'NEW BEST RIDER — ENTER YOUR CALLSIGN';
export const HINT_TEXT = 'type or tap  ·  BKSP  ·  DONE / Enter to confirm';

/** Fraction of the em box above / below the alphabetic baseline we budget for. */
const ASC = 0.82;
const DESC = 0.22;

export interface LayoutOpts {
  /** Canvas px per CSS px, so floors (key size, text size) are physical. */
  pxPerCss?: number;
  /** Height the summary above needs at scale s (0 = every line at its floor). */
  reserve?: (s: number) => number;
  /** Width of text at 100px in the given weight, to fit the prompt and hint. */
  measure?: (text: string, weight: number) => number;
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
 *
 * The result depends only on the screen, never on what the summary says, so
 * hit-testing and drawing cannot drift apart. Keys are as tall as the screen
 * allows while the summary still keeps a readable share (`reserve(0.6)`); a
 * short screen trades height first (keys go wide and short, which stays
 * tappable) and only then shrinks the summary to its floors.
 */
export function layout(W: number, H: number, u: number, bottomInset = 0, opts: LayoutOpts = {}): NameLayout {
  const pc = opts.pxPerCss ?? 1;
  const reserve = opts.reserve ?? (() => H * 0.46);
  const probe = (kh: number) => build(W, H, u, bottomInset, pc, kh, opts.measure);
  const widthCap = probe(1e9).rects[0].h; // largest height the width allows (square keys)
  const fits = (kh: number, s: number) => {
    const lay = probe(kh);
    return lay.promptTop - Math.max(5 * pc, 10 * u * lay.chrome) - reserve(s) >= 0;
  };
  const comfy = Math.min(widthCap, 30 * pc);
  const hard = Math.min(widthCap, 14 * pc);
  let kh = widthCap;
  const STEP = 0.97;
  if (!fits(kh, 0.6)) {
    // Largest height that keeps the summary comfortable, but never below comfy.
    while (kh * STEP >= comfy && !fits(kh, 0.6)) kh *= STEP;
    if (!fits(kh, 0.6)) {
      kh = Math.max(comfy, Math.min(kh, widthCap));
      // Still no room: summary at its floors, shave the keys only as far as needed.
      while (kh * STEP >= hard && !fits(kh, 0)) kh *= STEP;
    }
  }
  return probe(kh);
}

function build(
  W: number, H: number, u: number, bottomInset: number, pc: number, keyHIn: number,
  measure?: (text: string, weight: number) => number,
): NameLayout {
  const cols = 10;
  const rowsN = ROWS.length;
  const totalRows = rowsN + 1;
  const maxKbW = Math.min(W * 0.96, 660 * u);
  // Chrome (gaps, box, text) shrinks with the keys, down to a floor.
  const keyGuess = Math.min(keyHIn, (maxKbW - 9 * 7 * u) / cols);
  const c = Math.min(1, Math.max(0.4, keyGuess / (59 * u)));
  const gap = Math.max(3 * pc, 7 * u * c);
  const keyByW = (maxKbW - gap * (cols - 1)) / cols;
  const keyH = Math.min(keyHIn, keyByW);
  const keyW = Math.min(keyByW, keyH * 1.65);

  const vGap = Math.max(5 * pc, 18 * u * c);
  const boxH = Math.max(22 * pc, 48 * u * c);
  const promptGap = Math.max(4 * pc, 16 * u * c);
  const hintGap = Math.max(4 * pc, 11 * u * c);
  const padB = Math.max(4 * pc, 4 * u * c);
  let promptPx = Math.max(11 * pc, 22 * u * c);
  let hintPx = Math.max(9.5 * pc, 13 * u * c);
  if (measure) {
    promptPx = Math.min(promptPx, (0.94 * W * 100) / measure(PROMPT_TEXT, 800));
    hintPx = Math.min(hintPx, (0.94 * W * 100) / measure(HINT_TEXT, 600));
  }

  const hintBaseline = H - bottomInset - padB - DESC * hintPx;
  const kbBottom = hintBaseline - ASC * hintPx - hintGap;
  const kbH = totalRows * keyH + (totalRows - 1) * gap;
  const kbTop = kbBottom - kbH;
  const boxY = kbTop - vGap - boxH;
  const boxW = Math.min(W * 0.82, Math.max(260 * u * c, keyW * 6));
  const boxX = (W - boxW) / 2;
  const promptY = boxY - promptGap - DESC * promptPx;
  const promptTop = promptY - ASC * promptPx;

  const rects: KeyRect[] = [];
  ROWS.forEach((row, r) => {
    const chars = row.split('');
    const y = kbTop + r * (keyH + gap);
    const rowW = chars.length * keyW + (chars.length - 1) * gap;
    const x0 = (W - rowW) / 2;
    chars.forEach((ch, i) => {
      rects.push({ x: x0 + i * (keyW + gap), y, w: keyW, h: keyH, label: ch, ch, act: 'char' });
    });
  });

  const actionY = kbTop + rowsN * (keyH + gap);
  const topRowW = cols * keyW + (cols - 1) * gap;
  const spaceW = keyW * 4 + gap * 3;
  const actionW = (topRowW - spaceW - gap * 2) / 2;
  let actionX = (W - topRowW) / 2;
  rects.push({ x: actionX, y: actionY, w: spaceW, h: keyH, label: 'SPACE', ch: ' ', act: 'space' });
  actionX += spaceW + gap;
  rects.push({ x: actionX, y: actionY, w: actionW, h: keyH, label: 'BKSP', act: 'del' });
  actionX += actionW + gap;
  rects.push({ x: actionX, y: actionY, w: actionW, h: keyH, label: 'DONE', act: 'ok' });

  return {
    rects, boxX, boxY, boxW, boxH, promptY, hintY: hintBaseline,
    promptPx, hintPx,
    charPx: Math.min(18 * u, 0.5 * keyH),
    actPx: Math.max(Math.min(12 * u, 0.4 * keyH), Math.min(9.5 * pc, 0.45 * keyH)),
    boxPx: Math.min(30 * u, boxH * 0.6),
    promptTop, chrome: c,
  };
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

  const cu = u * lay.chrome; // radii and line widths follow the fitted chrome
  ctx.font = `800 ${lay.promptPx}px 'Trebuchet MS', sans-serif`;
  ctx.fillStyle = '#ffd76b';
  ctx.fillText(PROMPT_TEXT, W / 2, lay.promptY);

  // name box
  roundRect(ctx, lay.boxX, lay.boxY, lay.boxW, lay.boxH, 8 * cu);
  ctx.fillStyle = 'rgba(4,16,24,0.88)';
  ctx.fill();
  ctx.lineWidth = 2 * cu;
  ctx.strokeStyle = 'rgba(255,215,107,0.9)';
  ctx.stroke();

  const caret = Math.floor(time * 2) % 2 === 0 && value.length < NAME_MAX ? '_' : '';
  ctx.textBaseline = 'middle';
  ctx.font = `900 ${lay.boxPx}px monospace`;
  ctx.fillStyle = '#ffffff';
  ctx.fillText(value + caret || '_', W / 2, lay.boxY + lay.boxH / 2 + 2);

  // keys
  for (const k of lay.rects) {
    const accent = k.act === 'ok' ? '#8fe6c4' : k.act === 'del' ? '#ff8a8a' : '#ffe9c7';
    const fill = k.act === 'ok' ? 'rgba(143,230,196,0.16)' : k.act === 'del' ? 'rgba(255,120,120,0.14)' : 'rgba(6,20,28,0.82)';
    roundRect(ctx, k.x, k.y, k.w, k.h, 6 * cu);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.lineWidth = 1.4 * cu;
    ctx.strokeStyle = accent;
    ctx.globalAlpha = k.act === 'char' || k.act === 'space' ? 0.5 : 0.85;
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillStyle = accent;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `900 ${k.act === 'char' ? lay.charPx : lay.actPx}px ${k.act === 'char' ? 'monospace' : "'Trebuchet MS', sans-serif"}`;
    ctx.fillText(k.label, k.x + k.w / 2, k.y + k.h / 2 + 1);
  }

  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'center';
  ctx.font = `600 ${lay.hintPx}px 'Trebuchet MS', sans-serif`;
  ctx.fillStyle = 'rgba(255,255,255,0.72)';
  ctx.fillText(HINT_TEXT, W / 2, lay.hintY);
}
