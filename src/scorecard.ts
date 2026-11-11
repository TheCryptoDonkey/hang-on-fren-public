// Layout for the end-of-run score card. Pure (no canvas): the caller describes
// the summary lines and injects a text measurer, and gets back where every line
// goes, how big it is, and (when the run made the board) the callsign keyboard.
//
// The old card pinned each line at a fixed gap above the keyboard prompt and
// never checked that the stack fitted, so on a short phone the title was cropped
// off the top and the lines printed over one another. Here the whole stack is
// fitted: gaps compress first, then the fonts scale down toward readable floors,
// and long lines shrink or wrap to the width. The keyboard is fitted first from
// the screen alone (see nameentry.layout), so tapping and drawing share it.

import { layout as nameLayout, type NameLayout } from './nameentry.js';

const ASC = 0.82;
const DESC = 0.22;
const MIN_GAP_CSS = 2.5;
const MIN_GAP_FACTOR = 0.3;
const MAX_WIDTH = 0.94;

/** Width of `text` at 100px in the given weight (ctx.measureText in the game). */
export type Measure = (text: string, weight: number) => number;

export interface LineSpec {
  id: string;
  text: string;
  /** Nominal font size in u units (the old fixed sizes). */
  base: number;
  weight: number;
  /** Smallest size worth reading, in CSS px. */
  floor: number;
  /** Nominal gap above this line, in u units. */
  gap: number;
  /** Outline stroke in u units at the nominal size (0 for none). */
  outline?: number;
  /** Break at these parts onto further rows when one row is too wide. */
  wrap?: { parts: string[]; sep: string };
}

export interface PlacedLine {
  /** Spec id (wrapped rows share it). */
  id: string;
  text: string;
  y: number;
  px: number;
  /** Size relative to the nominal font: scales the outline stroke. */
  ratio: number;
  x0: number;
  x1: number;
  top: number;
  bottom: number;
}

export interface CardLayout {
  lines: PlacedLine[];
  entry: NameLayout | null;
}

export interface CardInput {
  W: number;
  H: number;
  u: number;
  /** Canvas px per CSS px. */
  pxPerCss: number;
  /** Space the browser owns at the bottom (touch devices). */
  bottomInset: number;
  qualifies: boolean;
  /** Canvas px at the bottom edge that the summary must stay clear of: the DOM
   *  support button on a card that is not asking for a callsign. */
  bottomReserve?: number;
  lines: LineSpec[];
  measure: Measure;
}

// The tallest summary the card can show, used to size the keyboard before the
// real lines are known: title, subtitle, score, time bonus and the longest stats
// line a stone tour can print (which may wrap). Real cards are never taller.
const WORST_PARTS = [
  'RIVAL LOSS', 'RANK S', '99.99 km', '999 roses', '999 overtakes', '999 km/h top', '99 joints', '99 sacred stones',
];
const WORST_SEP = '   ·   ';
const WORST: LineSpec[] = [
  { id: 'title', text: 'FINISH!', base: 72, weight: 900, floor: 22, gap: 0, outline: 8 },
  { id: 'subtitle', text: 'NEW HIGH SCORE · 10th BEST!', base: 30, weight: 800, floor: 12, gap: 22, outline: 6 },
  { id: 'score', text: 'SCORE  9,999,999', base: 40, weight: 800, floor: 16, gap: 16 },
  { id: 'bonus', text: 'TIME BONUS  99s × 100  =  +99,999', base: 22, weight: 700, floor: 12, gap: 15 },
  {
    id: 'stats', text: WORST_PARTS.join(WORST_SEP), base: 20, weight: 600, floor: 12, gap: 13,
    wrap: { parts: WORST_PARTS, sep: WORST_SEP },
  },
];

export interface SummaryData {
  won: boolean;
  /** "1st", "2nd"... when the run places on the board, else ''. */
  placeLabel: string;
  score: number;
  bonus: number;
  timeLeftS: number;
  bonusPerSec: number;
  rank: string;
  /** 'WIN' | 'LOSS' | '' when there was no rival. */
  rival: string;
  distanceM: number;
  roses: number;
  overtakes: number;
  topSpeedKph: number;
  /** The stone age counts its smokes and relics where road tours count roses. */
  stone: { joints: number; stones: number } | null;
  drifts: number;
  bestDriftS: number;
  /** Claim status, shown only on a card that is not asking for a callsign. */
  status: string;
  qualifies: boolean;
  touch: boolean;
}

export function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

/** The summary lines top to bottom, with their nominal sizes, floors and gaps. */
export function summaryLines(d: SummaryData): LineSpec[] {
  const parts = [
    ...(d.rival ? [`RIVAL ${d.rival}`] : []),
    `RANK ${d.rank}`,
    `${(d.distanceM / 1000).toFixed(2)} km`,
    count(d.roses, 'rose'),
    count(d.overtakes, 'overtake'),
    `${d.topSpeedKph} km/h top`,
    ...(d.stone ? [count(d.stone.joints, 'joint'), count(d.stone.stones, 'sacred stone')] : []),
  ];
  const sep = '   ·   ';
  const placed = `NEW HIGH SCORE · ${d.placeLabel} BEST!`;
  const lines: LineSpec[] = [];
  if (d.won) {
    lines.push({ id: 'title', text: 'FINISH!', base: 72, weight: 900, floor: 22, gap: 0, outline: 8 });
    lines.push(d.placeLabel
      ? { id: 'subtitle', text: placed, base: 30, weight: 800, floor: 12, gap: 22, outline: 6 }
      : { id: 'subtitleGoal', text: 'YOU REACHED THE GOAL, FREN!', base: 30, weight: 800, floor: 12, gap: 22, outline: 6 });
  } else {
    // The clock is the only way a run ends short (wipeouts cost time, never a life).
    lines.push({ id: 'titleLost', text: 'OUT OF TIME', base: 64, weight: 900, floor: 22, gap: 0 });
    if (d.placeLabel) lines.push({ id: 'subtitle', text: placed, base: 26, weight: 800, floor: 12, gap: 14, outline: 6 });
  }
  lines.push({
    id: 'score', text: `SCORE  ${d.score.toLocaleString('en-GB')}`,
    base: 40, weight: 800, floor: 16, gap: d.won || d.placeLabel ? 16 : 24,
  });
  if (d.won && d.bonus > 0) {
    lines.push({
      id: 'bonus',
      text: `TIME BONUS  ${d.timeLeftS}s × ${d.bonusPerSec}  =  +${d.bonus.toLocaleString('en-GB')}`,
      base: 22, weight: 700, floor: 12, gap: 15,
    });
  }
  lines.push({ id: 'stats', text: parts.join(sep), base: 20, weight: 600, floor: 12, gap: 13, wrap: { parts, sep } });
  if (!d.qualifies) {
    // The drift flourish is a secondary line; with the callsign keyboard up the
    // stack is already tight against it, so it only shows when not entering a name.
    if (d.drifts > 0) {
      lines.push({
        id: 'drift',
        text: `${count(d.drifts, 'drift')} landed   ·   longest ${d.bestDriftS.toFixed(1)}s sideways`,
        base: 17, weight: 700, floor: 10, gap: 8,
      });
    }
    // gamestr publish status (non-qualifying runs publish immediately; a board
    // run publishes on DONE and the title notice carries the outcome instead).
    if (d.status) lines.push({ id: 'status', text: d.status, base: 15, weight: 700, floor: 10.5, gap: 12 });
    lines.push({ id: 'cont', text: d.touch ? 'TAP TO CONTINUE' : 'PRESS ENTER / TAP TO CONTINUE', base: 26, weight: 800, floor: 14, gap: 30 });
  }
  return lines;
}

interface Row { id: string; text: string; px: number; ratio: number; w: number; pad: number; top: number }

/** Stack the lines at font scale `s` and gap factor `gk`; heights are relative to the stack top. */
function stack(
  lines: Array<Pick<LineSpec, 'base' | 'floor' | 'gap' | 'outline'> & Partial<LineSpec>>,
  u: number, pc: number, W: number, s: number, gk: number, measure?: Measure,
): { rows: Row[]; height: number } {
  const rows: Row[] = [];
  let cursor = 0;
  lines.forEach((spec, i) => {
    const desired = Math.max(spec.floor * pc, spec.base * u * s);
    const weight = spec.weight ?? 800;
    const maxW = MAX_WIDTH * W;
    const widthAt = (text: string, px: number) => (measure ? (measure(text, weight) * px) / 100 : 0);
    let px = desired;
    let texts: string[] = [spec.text ?? ''];
    if (measure && spec.text !== undefined) {
      const full = widthAt(spec.text, desired);
      if (full > maxW) {
        const fit = (desired * maxW) / full;
        // Shrink to the width unless that would fall below a readable size and
        // the line can wrap instead.
        if (spec.wrap && fit < Math.max(spec.floor * pc * 1.15, desired * 0.75)) {
          texts = wrapParts(spec.wrap.parts, spec.wrap.sep, px, maxW, text => widthAt(text, 1));
        } else {
          px = fit;
        }
      }
    }
    if (measure) {
      // A wrapped row can still be too wide if one part alone is.
      const widest = Math.max(...texts.map(t => widthAt(t, px)));
      if (widest > maxW) px = (px * maxW) / widest;
    }
    const pad = spec.outline ? 0.5 * spec.outline * (px / spec.base) : 0;
    texts.forEach((text, r) => {
      const gapAbove = i === 0 && r === 0 ? 0
        : r > 0 ? 0.3 * px
        : Math.max(MIN_GAP_CSS * pc, spec.gap * u * gk * s);
      const top = cursor + gapAbove;
      rows.push({ id: spec.id ?? '', text, px, ratio: px / spec.base, w: widthAt(text, px), pad, top });
      cursor = top + pad * 2 + (ASC + DESC) * px;
    });
  });
  return { rows, height: cursor };
}

function wrapParts(parts: string[], sep: string, px: number, maxW: number, widthPerPx: (t: string) => number): string[] {
  const out: string[] = [];
  let line = '';
  for (const part of parts) {
    const next = line ? line + sep + part : part;
    if (line && widthPerPx(next) * px > maxW) {
      out.push(line);
      line = part;
    } else {
      line = next;
    }
  }
  if (line) out.push(line);
  return out;
}

/** Fit the summary into `avail` px of height: compress gaps first, then scale fonts. */
function fit(
  lines: LineSpec[], u: number, pc: number, W: number, avail: number, measure: Measure,
): { rows: Row[]; height: number } {
  let best = stack(lines, u, pc, W, 1, 1, measure);
  if (best.height <= avail) return best;
  for (let gk = 0.95; gk >= MIN_GAP_FACTOR - 1e-9; gk -= 0.05) {
    best = stack(lines, u, pc, W, 1, gk, measure);
    if (best.height <= avail) return best;
  }
  for (let s = 0.98; s >= 0; s -= 0.02) {
    best = stack(lines, u, pc, W, Math.max(0, s), MIN_GAP_FACTOR, measure);
    if (best.height <= avail) return best;
  }
  return best; // every line at its floor: nothing more to give
}

let entryMemo: { key: string; lay: NameLayout } | null = null;

/** The callsign keyboard for this screen. Depends on the screen alone (never on the
 *  summary text), so tapping and drawing can both call it freely. */
export function entryLayout(W: number, H: number, u: number, pc: number, bottomInset: number, measure: Measure): NameLayout {
  const key = `${W}|${H}|${u}|${pc}|${bottomInset}`;
  if (entryMemo?.key === key) return entryMemo.lay;
  const topMargin = Math.max(6 * pc, 8 * u);
  const lay = nameLayout(W, H, u, bottomInset, {
    pxPerCss: pc,
    measure,
    reserve: s => topMargin + stack(WORST, u, pc, W, s, MIN_GAP_FACTOR, measure).height,
  });
  entryMemo = { key, lay };
  return lay;
}

export function cardLayout(inp: CardInput): CardLayout {
  const { W, H, u, pxPerCss: pc, qualifies, measure } = inp;
  const topMargin = Math.max(6 * pc, 8 * u);

  let entry: NameLayout | null = null;
  let regionBottom = H - Math.max(inp.bottomReserve ?? 0, Math.max(6 * pc, 8 * u));
  if (qualifies) {
    entry = entryLayout(W, H, u, pc, inp.bottomInset, measure);
    regionBottom = entry.promptTop - Math.max(5 * pc, 10 * u * entry.chrome);
  }

  const { rows, height } = fit(inp.lines, u, pc, W, regionBottom - topMargin, measure);
  // With the keyboard up the summary hugs the prompt (never lower than the old
  // 46% line on a roomy screen); a plain card sits a little above centre.
  let top: number;
  if (entry) {
    const bottom = Math.max(topMargin + height, Math.min(regionBottom, H * 0.46 + 4 * u));
    top = bottom - height;
  } else {
    top = topMargin + Math.max(0, regionBottom - topMargin - height) * 0.2;
  }

  const lines: PlacedLine[] = rows.map(r => {
    const baseline = top + r.top + r.pad + ASC * r.px;
    return {
      id: r.id, text: r.text, y: baseline, px: r.px, ratio: r.ratio,
      x0: W / 2 - r.w / 2 - r.pad, x1: W / 2 + r.w / 2 + r.pad,
      top: baseline - ASC * r.px - r.pad, bottom: baseline + DESC * r.px + r.pad,
    };
  });
  return { lines, entry };
}
