import { describe, it, expect } from 'vitest';
import { cardLayout, count, summaryLines, entryLayout, type SummaryData, type Measure } from './scorecard.js';

// Wide bold capitals: ~0.6 em per character at 100px, a touch wider than Trebuchet.
const measure: Measure = (text, weight) => text.length * (weight >= 800 ? 62 : 58);

interface Screen { name: string; cssW: number; cssH: number; touch: boolean; rs: number }

const SCREENS: Screen[] = [
  { name: '844x390 touch', cssW: 844, cssH: 390, touch: true, rs: 1.4 },
  { name: '844x390 touch dpr3', cssW: 844, cssH: 390, touch: true, rs: 2.2 },
  { name: '667x375 touch', cssW: 667, cssH: 375, touch: true, rs: 2 },
  { name: '390x844 touch portrait', cssW: 390, cssH: 844, touch: true, rs: 1.4 },
  { name: '1024x768 touch tablet', cssW: 1024, cssH: 768, touch: true, rs: 1.5 },
  { name: '1440x900 desktop', cssW: 1440, cssH: 900, touch: false, rs: 1 },
];

function dims(s: Screen) {
  const W = s.cssW * s.rs;
  const H = s.cssH * s.rs;
  const u = s.touch ? Math.max(Math.hypot(W, H) / 1468, 0.78 * s.rs) : Math.hypot(W, H) / 1468;
  return { W, H, u, inset: s.touch ? 44 * u : 0 };
}

const BASE: SummaryData = {
  won: true, placeLabel: '', score: 123456, bonus: 0, timeLeftS: 0, bonusPerSec: 100, rank: 'A',
  rival: '', distanceM: 21000, roses: 12, overtakes: 34, topSpeedKph: 312, stone: null,
  drifts: 0, bestDriftS: 0, status: '', qualifies: false, touch: true,
};

interface Case { name: string; data: SummaryData }

const CASES: Case[] = [];
for (const won of [true, false]) {
  for (const qualifies of [true, false]) {
    for (const bonus of won ? [0, 54000] : [0]) {
      CASES.push({
        name: `${won ? 'won' : 'lost'} ${qualifies ? 'board' : 'no board'}${bonus ? ' bonus' : ''}`,
        data: { ...BASE, won, qualifies, placeLabel: qualifies ? '3rd' : '', bonus, timeLeftS: bonus ? 18 : 0 },
      });
    }
  }
}
CASES.push(
  {
    name: 'stone tour, rival, long stats',
    data: { ...BASE, stone: { joints: 14, stones: 5 }, rival: 'WIN', distanceM: 21000, roses: 0, overtakes: 123, topSpeedKph: 412, bonus: 54000, timeLeftS: 18 },
  },
  {
    name: 'stone tour on the board',
    data: { ...BASE, qualifies: true, placeLabel: '10th', stone: { joints: 14, stones: 5 }, rival: 'LOSS', bonus: 54000, timeLeftS: 18 },
  },
  { name: '7-digit score', data: { ...BASE, score: 1234567, bonus: 987654, timeLeftS: 99 } },
  {
    name: 'claim status line',
    data: { ...BASE, won: false, drifts: 7, bestDriftS: 3.4, status: 'CLAIMING ON GAMESTR…' },
  },
  {
    name: 'long claim status',
    data: { ...BASE, drifts: 7, bestDriftS: 3.4, status: 'CLAIMED ON GAMESTR · SCORE PUBLISHED TO 4 RELAYS' },
  },
);

function layoutFor(s: Screen, data: SummaryData) {
  const d = dims(s);
  const lines = summaryLines(data);
  const card = cardLayout({
    W: d.W, H: d.H, u: d.u, pxPerCss: s.rs, bottomInset: d.inset, qualifies: data.qualifies, lines, measure,
  });
  return { ...d, card };
}

describe('summaryLines', () => {
  it('pluralises counts', () => {
    expect(count(1, 'rose')).toBe('1 rose');
    expect(count(0, 'rose')).toBe('0 roses');
    expect(count(2, 'overtake')).toBe('2 overtakes');
    const text = summaryLines({ ...BASE, roses: 1, overtakes: 1, stone: { joints: 1, stones: 1 } })
      .find(l => l.id === 'stats')!.text;
    expect(text).toContain('1 rose ');
    expect(text).toContain('1 overtake ');
    expect(text).toContain('1 joint ');
    expect(text.endsWith('1 sacred stone')).toBe(true);
    expect(text).not.toMatch(/\b1 (roses|overtakes|joints|sacred stones)/);
  });

  it('keeps the plural when it is not one', () => {
    const text = summaryLines({ ...BASE, roses: 2, overtakes: 0, stone: { joints: 3, stones: 0 } })
      .find(l => l.id === 'stats')!.text;
    expect(text).toContain('2 roses');
    expect(text).toContain('0 overtakes');
    expect(text).toContain('3 joints');
    expect(text).toContain('0 sacred stones');
  });

  it('pluralises the drift line', () => {
    const one = summaryLines({ ...BASE, drifts: 1, bestDriftS: 1.2 }).find(l => l.id === 'drift')!.text;
    expect(one.startsWith('1 drift landed')).toBe(true);
  });

  it('drops the continue prompt and drift line while a callsign is being entered', () => {
    const ids = summaryLines({ ...BASE, qualifies: true, drifts: 3, bestDriftS: 2 }).map(l => l.id);
    expect(ids).not.toContain('cont');
    expect(ids).not.toContain('drift');
  });
});

describe('score card layout', () => {
  for (const s of SCREENS) {
    for (const c of CASES) {
      it(`${s.name}: ${c.name} fits without overlap`, () => {
        const { W, H, card } = layoutFor(s, c.data);
        const eps = 0.5;
        expect(card.lines.length).toBeGreaterThan(0);
        for (const l of card.lines) {
          expect(l.top).toBeGreaterThanOrEqual(-eps);
          expect(l.bottom).toBeLessThanOrEqual(H + eps);
          expect(l.x0).toBeGreaterThanOrEqual(-eps);
          expect(l.x1).toBeLessThanOrEqual(W + eps);
        }
        for (let i = 1; i < card.lines.length; i++) {
          expect(card.lines[i].top).toBeGreaterThanOrEqual(card.lines[i - 1].bottom - eps);
        }
        if (card.entry) {
          const last = card.lines[card.lines.length - 1];
          expect(last.bottom).toBeLessThanOrEqual(card.entry.promptTop + eps);
        }
      });
    }

    it(`${s.name}: keyboard is inside the screen, clear of the tap zone, and readable`, () => {
      const { W, H, u, inset } = dims(s);
      const lay = entryLayout(W, H, u, s.rs, inset, measure);
      const eps = 0.5;
      expect(lay.rects.length).toBe(39);
      for (const k of lay.rects) {
        expect(k.x).toBeGreaterThanOrEqual(-eps);
        expect(k.x + k.w).toBeLessThanOrEqual(W + eps);
        expect(k.y).toBeGreaterThanOrEqual(-eps);
        expect(k.y + k.h).toBeLessThanOrEqual(H - inset + eps);
      }
      expect(lay.boxY + lay.boxH).toBeLessThanOrEqual(lay.rects[0].y + eps);
      expect(lay.hintY).toBeLessThanOrEqual(H + eps);
      // Keys stay finger-sized: at least 16 CSS px tall even on the shortest phone.
      const keyH = lay.rects[0].h / s.rs;
      expect(keyH).toBeGreaterThanOrEqual(16);
      // Roomy screens keep big keys.
      if (s.cssH >= 700) expect(keyH).toBeGreaterThanOrEqual(30);
    });
  }

  it('does not depend on the summary text: the keyboard is the same for any card', () => {
    const s = SCREENS[0];
    const a = layoutFor(s, { ...BASE, qualifies: true, placeLabel: '1st' }).card.entry!;
    const b = layoutFor(s, { ...BASE, qualifies: true, placeLabel: '10th', stone: { joints: 1, stones: 1 }, bonus: 5, timeLeftS: 1 }).card.entry!;
    expect(a.rects).toEqual(b.rects);
  });

  it('shrinks the summary before the keys on a short phone', () => {
    const s = SCREENS[0];
    const { card } = layoutFor(s, { ...BASE, qualifies: true, placeLabel: '3rd', bonus: 1000, timeLeftS: 10 });
    const title = card.lines.find(l => l.id === 'title')!;
    expect(title.px / s.rs).toBeLessThan(72);
    expect(title.px / s.rs).toBeGreaterThanOrEqual(22);
  });

  it('wraps the longest stats line rather than shrinking it unreadably', () => {
    const s = SCREENS[2];
    const { card } = layoutFor(s, CASES.find(c => c.name === 'stone tour, rival, long stats')!.data);
    for (const l of card.lines.filter(x => x.id === 'stats')) expect(l.px / s.rs).toBeGreaterThanOrEqual(10);
  });
});
