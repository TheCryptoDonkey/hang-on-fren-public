// The trim manifest is generated from public/ by tools/trim-manifest.mjs. This
// fails when the two drift apart (a sprite added, removed or re-exported), so
// a stale manifest can never reach a build. It needs no browser: bounds and
// the `clean` flags only change with the pixels, and the pixels only change
// with the file hash.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { ART_URLS, isFullBleed } from './sprites.js';
import { TRIM_MANIFEST } from './trim-manifest.js';

const REGENERATE = 'run `node tools/trim-manifest.mjs` and commit src/trim-manifest.ts';
const trimmedNames = Object.keys(ART_URLS).filter(name => !isFullBleed(name)).sort();
// ART_URLS holds assetUrl() results; under test the base is '/'.
const fileOf = (name: string): string => ART_URLS[name].replace(/^\/+/, '');

describe('trim manifest', () => {
  it('has exactly one entry per trimmed sprite', () => {
    const missing = trimmedNames.filter(name => !(name in TRIM_MANIFEST));
    const extra = Object.keys(TRIM_MANIFEST).filter(name => !trimmedNames.includes(name));
    expect({ missing, extra }, REGENERATE).toEqual({ missing: [], extra: [] });
  });

  it('points each entry at the file the game loads', () => {
    for (const name of trimmedNames) expect(TRIM_MANIFEST[name]?.file, `${name}: ${REGENERATE}`).toBe(fileOf(name));
  });

  it('matches the art on disk byte for byte', () => {
    const stale: string[] = [];
    for (const name of trimmedNames) {
      const entry = TRIM_MANIFEST[name];
      const path = `public/${fileOf(name)}`;
      if (!entry || !existsSync(path)) { stale.push(`${name} (missing file)`); continue; }
      if (createHash('sha256').update(readFileSync(path)).digest('hex') !== entry.sha256) stale.push(`${name} (changed)`);
    }
    expect(stale, REGENERATE).toEqual([]);
  });

  it('records sane bounds', () => {
    for (const [name, e] of Object.entries(TRIM_MANIFEST)) {
      expect(e.tw > 0 && e.th > 0, name).toBe(true);
      expect(e.x >= 0 && e.y >= 0 && e.x + e.tw <= e.w && e.y + e.th <= e.h, name).toBe(true);
    }
  });
});
