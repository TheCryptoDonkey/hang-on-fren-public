import { describe, it, expect } from 'vitest';
import {
  addPopup, updatePopups, placePopups, popupY, POPUP_RISE,
  type Popup, type PopupEnv, type Rect,
} from './hud.js';

const U = 1;
// A fixed-pitch stand-in for measureText: 0.6 em per character.
const measure = (text: string, px: number): number => text.length * px * 0.6;

function env(w: number, h: number, zones: Rect[] = [], u = U): PopupEnv {
  return { w, h, u, zones, measure };
}

/** The box a placed popup occupies `age` seconds in (matches the engine's own extents). */
function box(p: Popup, age: number, u = U): Rect {
  const px = p.px as number;
  const y = (p.ly as number) - POPUP_RISE * u * age;
  const wid = p.wid as number;
  return { x0: (p.lx as number) - wid / 2, x1: (p.lx as number) + wid / 2, y0: y - 0.8 * px, y1: y + 0.28 * px };
}

function overlap(a: Rect, b: Rect): boolean {
  return a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
}

const CHECKPOINT: [string, number][] = [
  ['CHECKPOINT', 0.24],
  ['LEVEL 2 / 10', 0.3],
  ['TROPICO BAY', 0.37],
  ['BEAR MARKET', 0.43],
  ['STAGE 1 — S RANK  ·  100', 0.5],
  ['YOU AHEAD  120m', 0.56],
];

describe('placePopups', () => {
  it('gives popups spawned at the same spot rows of their own, for their whole life', () => {
    const list: Popup[] = [];
    for (let i = 0; i < 6; i += 1) addPopup(list, `LINE ${i}`, 400, 200, '#fff', 1 + i * 0.3);
    placePopups(list, env(800, 600));
    expect(list.every(p => p.ly !== undefined && !p.held)).toBe(true);
    for (let t = 0; t <= 3; t += 0.1) {
      for (let a = 0; a < list.length; a += 1) {
        for (let b = a + 1; b < list.length; b += 1) {
          // Compare at a shared clock, but only while both are alive.
          if (t > list[a].ttl || t > list[b].ttl) continue;
          expect(overlap(box(list[a], t), box(list[b], t))).toBe(false);
        }
      }
    }
  });

  it('keeps the checkpoint block out of the TIME / ROSE readout and in reading order', () => {
    const list: Popup[] = [];
    const H = 780;
    for (const [text, f] of CHECKPOINT) addPopup(list, text, 844, H * f, '#fff', 2);
    const time: Rect = { x0: 844 - 74, y0: 6, x1: 844 + 74, y1: 126 };
    placePopups(list, env(1688, H, [time], 1.56));
    const placedNow = list.filter(p => !p.held);
    expect(placedNow.length).toBeGreaterThan(0);
    for (const p of placedNow) {
      for (let t = 0; t <= 2; t += 0.1) expect(overlap(box(p, t, 1.56), time)).toBe(false);
    }
    const ys = placedNow.map(p => p.ly as number);
    expect([...ys].sort((a, b) => a - b)).toEqual(ys); // top to bottom, in spawn order
  });

  it('leaves a popup alone when it already has clear space', () => {
    const list: Popup[] = [];
    addPopup(list, '+500', 300, 250, '#fff', 1);
    placePopups(list, env(800, 600));
    expect(list[0].lx).toBe(300);
    expect(list[0].ly).toBe(250);
  });

  it('moves a popup out of a reserved zone', () => {
    const list: Popup[] = [];
    addPopup(list, 'CHECKPOINT', 400, 100, '#fff', 1.3);
    const zone: Rect = { x0: 300, y0: 0, x1: 500, y1: 130 };
    placePopups(list, env(800, 600, [zone]));
    for (let t = 0; t <= 1.3; t += 0.1) expect(overlap(box(list[0], t), zone)).toBe(false);
  });

  it('shrinks a line too wide for the screen instead of clipping it', () => {
    const list: Popup[] = [];
    addPopup(list, 'CHEAT ON — THIS RUN STAYS OFF GAMESTR', 195, 300, '#fff', 2);
    placePopups(list, env(390, 800));
    const p = list[0];
    expect(p.px as number).toBeLessThan(24);
    expect(p.wid as number).toBeLessThanOrEqual(390 - 24);
    expect(box(p, 0).x0).toBeGreaterThanOrEqual(0);
    expect(box(p, 0).x1).toBeLessThanOrEqual(390);
  });

  it('keeps a popup inside the screen horizontally', () => {
    const list: Popup[] = [];
    addPopup(list, 'TURBO!', 5, 300, '#fff', 1);
    addPopup(list, 'MEME!', 795, 300, '#fff', 1);
    placePopups(list, env(800, 600));
    for (const p of list) {
      expect(box(p, 0).x0).toBeGreaterThanOrEqual(0);
      expect(box(p, 0).x1).toBeLessThanOrEqual(800);
    }
  });

  it('holds a popup that has no free row, then places it when one frees up, losing none', () => {
    // A screen with room for about two rows.
    const list: Popup[] = [];
    for (let i = 0; i < 5; i += 1) addPopup(list, `MSG ${i}`, 200, 90, '#fff', 1);
    const e = env(400, 130);
    placePopups(list, e);
    const shown = list.filter(p => !p.held);
    expect(shown.length).toBeGreaterThan(0);
    expect(shown.length).toBeLessThan(5);
    const heldBefore = list.filter(p => p.held).map(p => p.text);

    // Held popups do not tick; shown ones do.
    updatePopups(list, 0.5);
    for (const p of list) expect(p.life).toBeCloseTo(p.held ? 1 : 0.5, 5);

    // Run the clock: as rows free, held popups get placed. Every message is shown at some point.
    const seen = new Set(shown.map(p => p.text));
    for (let i = 0; i < 200 && list.length > 0; i += 1) {
      placePopups(list, e);
      for (const p of list) if (!p.held) seen.add(p.text);
      updatePopups(list, 0.05);
    }
    expect(list.length).toBe(0);
    expect(seen.size).toBe(5);
    for (const text of heldBefore) expect(seen.has(text)).toBe(true);
  });

  it('re-places every popup when the buffer size or scale changes', () => {
    const list: Popup[] = [];
    addPopup(list, 'LEVEL 2 / 10', 400, 200, '#fff', 2);
    addPopup(list, 'TROPICO BAY', 400, 200, '#fff', 2);
    placePopups(list, env(800, 600));
    const before = list.map(p => p.ly);
    placePopups(list, env(800, 600)); // unchanged: untouched
    expect(list.map(p => p.ly)).toEqual(before);
    placePopups(list, env(1600, 1200, [], 2));
    const a = box(list[0], 0, 2);
    const b = box(list[1], 0, 2);
    expect(overlap(a, b)).toBe(false);
    expect(list[0].lu).toBe(2);
  });

  it('draws popups where they were placed, floating at one shared speed', () => {
    const list: Popup[] = [];
    addPopup(list, 'A', 100, 200, '#fff', 1);
    addPopup(list, 'B', 100, 200, '#fff', 3);
    placePopups(list, env(400, 600));
    const gap0 = popupY(list[1], U) - popupY(list[0], U);
    updatePopups(list, 0.7);
    expect(popupY(list[1], U) - popupY(list[0], U)).toBeCloseTo(gap0, 6);
    expect(popupY(list[0], U)).toBeCloseTo((list[0].ly as number) - POPUP_RISE * 0.7, 6);
  });
});

describe('popup list', () => {
  it('still caps at twelve, dropping the oldest', () => {
    const list: Popup[] = [];
    for (let i = 0; i < 15; i += 1) addPopup(list, `P${i}`, 0, 0, '#fff');
    expect(list.length).toBe(12);
    expect(list[0].text).toBe('P3');
  });

  it('expires popups as their life runs out', () => {
    const list: Popup[] = [];
    addPopup(list, 'X', 0, 0, '#fff', 0.5);
    updatePopups(list, 0.3);
    expect(list.length).toBe(1);
    updatePopups(list, 0.3);
    expect(list.length).toBe(0);
  });
});
