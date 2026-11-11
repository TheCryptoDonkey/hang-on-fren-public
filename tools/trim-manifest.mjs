#!/usr/bin/env node
// Build-time trim manifest for the alpha-trimmed sprites.
//
// At runtime loadTrimmed() reads every sprite back (getImageData) to erase
// sub-floor alpha and find the opaque bounding box. This tool runs that very
// scan (src/sprites.ts scanTrim) once, in headless Chromium, and records the
// result in src/trim-manifest.ts so the runtime can skip it where that is
// provably safe:
//
//   - bounds are always recorded;
//   - `clean` is true only when a plain cropped blit of the source gives a
//     canvas with the same dimensions AND the same RGBA buffer as the scan,
//     i.e. the sprite has no 0 < alpha < ALPHA_FLOOR pixels inside its box.
//     Only clean entries take the no-readback path at runtime.
//
// Usage (from the repo root):
//   node tools/trim-manifest.mjs            regenerate src/trim-manifest.ts
//   node tools/trim-manifest.mjs --verify   prove the committed manifest
//                                           against the runtime scan
//
// Staleness against public/ is checked without a browser by
// src/trim-manifest.test.ts (file hashes), so `npm test` catches an art change
// that was not followed by a regenerate.
//
// Needs the dev dependencies only (vite, playwright). Port 5192 is used for the
// throwaway dev server; override with TRIM_MANIFEST_PORT.

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'src', 'trim-manifest.ts');
const PORT = Number(process.env.TRIM_MANIFEST_PORT ?? 5192);
const verify = process.argv.includes('--verify');

const sha256 = file => createHash('sha256').update(readFileSync(join(ROOT, 'public', file))).digest('hex');

/** In-page: scan every trimmed sprite with the game's own code. With
 *  `expected` (the committed manifest) it also checks the manifest against the
 *  scan; without it, it measures. */
async function inPage(expected) {
  const { ART_URLS, isFullBleed, loadImage, scanTrim, cropTrim } = await import('/src/sprites.ts');
  const read = canvas => canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, canvas.width, canvas.height).data;
  const sameBuffer = (a, b) => {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
    return true;
  };
  const rows = [];
  for (const [name, url] of Object.entries(ART_URLS)) {
    if (isFullBleed(name)) continue;
    const img = await loadImage(url);
    if (!img) { rows.push({ name, error: 'failed to load' }); continue; }
    const scanned = scanTrim(img);
    if (!scanned) { rows.push({ name, error: 'nothing opaque' }); continue; }
    const { sprite, bounds } = scanned;
    const cropped = cropTrim(img, bounds);
    const sameDims = cropped.canvas.width === sprite.canvas.width && cropped.canvas.height === sprite.canvas.height;
    const pixelsEqual = sameDims && sameBuffer(read(cropped.canvas), read(sprite.canvas));
    const row = { name, url, w: img.width, h: img.height, ...bounds, clean: pixelsEqual };
    if (expected) {
      const e = expected[name];
      row.inManifest = Boolean(e);
      row.boundsMatch = Boolean(e) && e.x === bounds.x && e.y === bounds.y && e.tw === bounds.tw && e.th === bounds.th && e.w === img.width && e.h === img.height;
      row.cleanMatch = Boolean(e) && e.clean === pixelsEqual;
      // What the runtime would build for this entry, against the scan.
      const fastPath = Boolean(e?.clean);
      const built = fastPath ? cropTrim(img, e) : null;
      row.fastPath = fastPath;
      row.dimsEqual = built ? built.canvas.width === sprite.canvas.width && built.canvas.height === sprite.canvas.height && built.w === sprite.w && built.h === sprite.h : true;
      row.pixelsEqual = built ? row.dimsEqual && sameBuffer(read(built.canvas), read(sprite.canvas)) : true;
    }
    rows.push(row);
  }
  return rows;
}

const server = await createServer({
  root: ROOT,
  logLevel: 'error',
  server: { port: PORT, strictPort: true, host: '127.0.0.1', proxy: {} },
});
await server.listen();
const browser = await chromium.launch({ headless: true });
let code = 0;
try {
  const page = await browser.newPage();
  page.on('pageerror', e => console.error('page error:', e.message));
  // A blank same-origin page: the game's own index.html would boot the game.
  await page.route('**/__trim.html', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>trim</title>' }));
  await page.goto(`http://127.0.0.1:${PORT}/__trim.html`);

  if (verify) {
    const { TRIM_MANIFEST } = await server.ssrLoadModule('/src/trim-manifest.ts');
    const rows = await page.evaluate(`(${inPage.toString()})(${JSON.stringify(TRIM_MANIFEST)})`);
    const bad = rows.filter(r => r.error || !r.inManifest || !r.boundsMatch || !r.cleanMatch || !r.dimsEqual || !r.pixelsEqual);
    const fast = rows.filter(r => r.fastPath);
    const extra = Object.keys(TRIM_MANIFEST).filter(n => !rows.some(r => r.name === n));
    console.log(`trimmed sprites checked: ${rows.length}`);
    console.log(`  bounds + source size equal to runtime scan: ${rows.filter(r => r.boundsMatch).length}/${rows.length}`);
    console.log(`  fast path (clean): ${fast.length}, canvas dimensions equal: ${fast.filter(r => r.dimsEqual).length}, RGBA buffers identical: ${fast.filter(r => r.pixelsEqual).length}`);
    console.log(`  scan fallback (not clean, sub-floor alpha inside the box): ${rows.length - fast.length}`);
    if (extra.length) console.log(`  manifest entries with no sprite: ${extra.join(', ')}`);
    if (bad.length || extra.length) {
      for (const r of bad) console.error('MISMATCH', JSON.stringify(r));
      code = 1;
    } else {
      console.log('manifest matches the runtime scan');
    }
  } else {
    const rows = await page.evaluate(`(${inPage.toString()})()`);
    const failed = rows.filter(r => r.error);
    if (failed.length) throw new Error(`cannot trim: ${failed.map(r => `${r.name} (${r.error})`).join(', ')}`);
    rows.sort((a, b) => (a.name < b.name ? -1 : 1));
    const lines = rows.map(r => {
      const file = r.url.replace(/^\/+/, '');
      return `  ${JSON.stringify(r.name)}: { file: ${JSON.stringify(file)}, sha256: ${JSON.stringify(sha256(file))}, w: ${r.w}, h: ${r.h}, x: ${r.x}, y: ${r.y}, tw: ${r.tw}, th: ${r.th}, clean: ${r.clean} },`;
    });
    writeFileSync(OUT, `// GENERATED by tools/trim-manifest.mjs - do not edit; run \`node tools/trim-manifest.mjs\`
// after any change to a trimmed sprite under public/ (src/trim-manifest.test.ts
// fails until you do).
//
// Per sprite name: the source file and its hash, the decoded size, the opaque
// bounding box the runtime scan finds, and whether a plain cropped blit gives
// the same pixels as that scan (\`clean\`: no sub-floor alpha inside the box).
// Only clean entries skip the getImageData pass in loadTrimmed.

export interface TrimEntry {
  file: string;
  sha256: string;
  w: number;
  h: number;
  x: number;
  y: number;
  tw: number;
  th: number;
  clean: boolean;
}

export const TRIM_MANIFEST: Readonly<Record<string, TrimEntry>> = {
${lines.join('\n')}
};
`);
    console.log(`wrote src/trim-manifest.ts: ${rows.length} sprites, ${rows.filter(r => r.clean).length} clean`);
  }
} finally {
  await browser.close();
  await server.close();
}
process.exit(code);
