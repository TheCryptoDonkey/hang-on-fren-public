import { describe, it, expect } from 'vitest';
import { NAME_MAX, isNameChar, appendChar, backspace, cleanName, layout, keyAt } from './nameentry.js';

describe('nameentry', () => {
  it('accepts A-Z, 0-9, and space, rejects everything else', () => {
    expect(isNameChar('A')).toBe(true);
    expect(isNameChar('z')).toBe(true);
    expect(isNameChar('7')).toBe(true);
    expect(isNameChar(' ')).toBe(true);
    expect(isNameChar('!')).toBe(false);
    expect(isNameChar('AB')).toBe(false);
  });

  it('appends uppercased chars up to the max length', () => {
    let v = '';
    for (const c of 'frenzy') v = appendChar(v, c);
    expect(v).toBe('FRENZY');
    expect(appendChar('ACE', ' ')).toBe('ACE ');
    v = 'ABCDEFGHIJKL'; // already NAME_MAX (12)
    expect(v.length).toBe(NAME_MAX);
    expect(appendChar(v, 'Z')).toBe(v); // no overflow
    expect(appendChar('AB', '-')).toBe('AB'); // punctuation ignored
  });

  it('backspaces from the end', () => {
    expect(backspace('ACE')).toBe('AC');
    expect(backspace('')).toBe('');
  });

  it('cleans to a callsign and falls back when blank', () => {
    expect(cleanName('  ')).toBe('FRN');
    expect(cleanName('!!!')).toBe('FRN');
    expect(cleanName('ace 99')).toBe('ACE 99');
    expect(cleanName('ace   99')).toBe('ACE 99');
    expect(cleanName('abcdefghijklmnop')).toBe('ABCDEFGHIJKL'); // trimmed to max
  });

  it('lays out an on-screen keyboard fully within the screen', () => {
    for (const [W, H] of [[1920, 1080], [390, 844], [844, 390]] as const) {
      const lay = layout(W, H, Math.hypot(W, H) / 1468);
      expect(lay.rects.length).toBe(36 + 3); // QWERTY chars + SPACE + BKSP + DONE
      expect(lay.rects.some(k => k.act === 'space')).toBe(true);
      expect(lay.rects.some(k => k.act === 'del')).toBe(true);
      expect(lay.rects.some(k => k.act === 'ok')).toBe(true);
      for (const k of lay.rects) {
        expect(k.x).toBeGreaterThanOrEqual(0);
        expect(k.y).toBeGreaterThanOrEqual(0);
        expect(k.x + k.w).toBeLessThanOrEqual(W + 0.5);
        expect(k.y + k.h).toBeLessThanOrEqual(H + 0.5);
      }
    }
  });

  it('hit-tests keys by point', () => {
    const lay = layout(1280, 720, 1);
    const a = lay.rects.find(k => k.label === 'A')!;
    const hit = keyAt(lay.rects, a.x + a.w / 2, a.y + a.h / 2);
    expect(hit?.label).toBe('A');
    expect(keyAt(lay.rects, -10, -10)).toBeNull();
  });
});
