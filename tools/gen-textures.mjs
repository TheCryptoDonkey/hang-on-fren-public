// Reproducible GROUND TEXTURE generation for Hang On, Fren.
//
// Seamless-ish tileable ground materials for the pseudo-3D road renderer
// (render.ts pattern-fills these in perspective, tinting them to the biome
// palette with a luminosity blend — so each material is generated ONCE in
// natural colour and serves every region).
//
// gpt-image-2 (textures are opaque — no alpha needed). Full-res originals land
// in art-originals/art/texture-*.png; bake-textures (in optimise-assets.sh)
// crops, pixel-downscales and mirror-bakes them into public/art/*.webp, which
// makes the final tile seamless BY CONSTRUCTION even where the model's edges
// don't quite wrap.
//
// Usage:
//   node tools/gen-textures.mjs                  # generate any missing
//   node tools/gen-textures.mjs --only sand      # subset by name prefix
//   node tools/gen-textures.mjs --force          # regenerate existing
//
// The game runs without these files (procedural tiles are the fallback).

import { existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const OUT = resolve(ROOT, 'art-originals/art');

const KEY = process.env.OPENAI_API_KEY || process.env.OPEN_API_KEY;
if (!KEY) {
  console.error('No OPENAI_API_KEY / OPEN_API_KEY in env.');
  process.exit(1);
}

const args = process.argv.slice(2);
const force = args.includes('--force');
const onlyIdx = args.indexOf('--only');
const only = onlyIdx >= 0 ? args[onlyIdx + 1] : null;

const TEX_STYLE =
  ' Rendered as a SEAMLESS TILEABLE video-game ground texture: viewed flat from DIRECTLY ABOVE (orthographic ' +
  'top-down, no perspective, no horizon), chunky 16-bit Sega Mega Drive / arcade pixel-art style with big visible ' +
  'square pixels and a small limited colour palette, perfectly even lighting with NO cast shadows, NO objects, ' +
  'NO border, NO vignette, NO text — a uniform repeating material that fills the whole frame edge to edge, with ' +
  'the left edge matching the right edge and the top edge matching the bottom edge so it tiles without seams.';

const TEXTURES = [
  { name: 'texture-grass', prompt: 'Lush green Mediterranean roadside grass: dense short lawn with pixel tufts, blade clusters and small light/dark mottling.' },
  { name: 'texture-sand', prompt: 'Golden beach sand: fine grain with gentle wind ripple lines, scattered brighter grains and a few tiny darker pebbles.' },
  { name: 'texture-snow', prompt: 'Clean fresh white snow: soft drift undulations in pale blue-white, subtle powder shadows and a scattering of tiny bright sparkle glints.' },
  { name: 'texture-leaves', prompt: 'Autumn forest floor: a dense carpet of small fallen leaves in rust orange, amber, gold and brown, with a few darker twigs.' },
  { name: 'texture-ash', prompt: 'Volcanic ash field: near-black charred grit and cinder gravel with dark grey basalt flecks and a very few tiny glowing orange embers.' },
  { name: 'texture-asphalt', prompt: 'Dark night-time concrete expressway shoulder: deep blue-grey aggregate with sparse paler flecks and faint tonal patches.' },
  { name: 'texture-rock', prompt: 'Weathered rocky shoulder scree: small grey-brown stones, cracked rock chips and dusty gravel in muted earth tones.' },
  { name: 'texture-tarmac', prompt: 'Plain mid-grey road asphalt: fine tarmac aggregate with subtle lighter and darker speckle and faint wear patches, understated and uniform.' },
  { name: 'texture-water', prompt: 'Sparkling sea surface: small choppy waves in two or three blues with pale wave-crest highlights, gentle and repeating.' },
];

async function generate(spec) {
  const outPath = resolve(OUT, `${spec.name}.png`);
  if (!force && existsSync(outPath)) {
    console.log(`skip  ${spec.name} (exists)`);
    return;
  }
  process.stdout.write(`gen   ${spec.name} (gpt-image-2) ... `);
  const res = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-image-2',
      prompt: spec.prompt + TEX_STYLE,
      size: '1024x1024',
      quality: 'high',
    }),
  });
  const json = await res.json();
  if (!json.data || !json.data[0]?.b64_json) {
    console.log('FAILED');
    console.error(JSON.stringify(json).slice(0, 400));
    throw new Error(`generation failed for ${spec.name}`);
  }
  writeFileSync(outPath, Buffer.from(json.data[0].b64_json, 'base64'));
  console.log(`ok (${json.usage?.total_tokens ?? '?'} tok)`);
}

mkdirSync(OUT, { recursive: true });
const queue = TEXTURES.filter(t => !only || t.name.startsWith(only) || t.name.startsWith(`texture-${only}`));
console.log(`generating ${queue.length} texture(s)${only ? ` matching "${only}"` : ''}${force ? ' [force]' : ''}`);
for (const spec of queue) {
  await generate(spec);
}
console.log('done — now run: bash tools/optimise-assets.sh (bakes tiles into public/art)');
