// Napplet edition build (NIP-5D) for napplet.soy and other napplet shells. The
// web build (vite.config.ts) is untouched; this config swaps the modules that
// need network access, browser storage or the arcade window for napplet
// versions in src/napplet/.
//
// Output:
// - dist-napplet/index.html: the small single-file napplet.
// - dist-napplet-assets/: the external files it loads through the shell from
//   Blossom, by sha256: art.hofpack (art, pickups, sfx) and one 96 kbps stereo
//   AAC file per music bed, plus assets.json listing them. Register these with
//   the publishing project (tools/napplet-sync.mjs) before publishing.
//
// HOF_NAPPLET_MUSIC=none leaves the music out.
import { defineConfig, type Plugin } from 'vite';
import { nip5aManifest } from '@napplet/vite-plugin';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname);
const SRC = join(ROOT, 'src');
const PUBLIC = join(ROOT, 'public');
const MUSIC_CACHE = join(ROOT, 'node_modules/.cache/hof-napplet-music');
const ASSET_MODULE = 'virtual:hof-napplet-assets';
const ASSETS_OUT = join(ROOT, 'dist-napplet-assets');
const PACKED_DIRS = ['art/', 'pickups/', 'sfx/'];
// Blossom resources are capped at 10 MiB each.
const MAX_EXTERNAL_BYTES = 10 * 1024 * 1024;
const MIME: Record<string, string> = {
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.m4a': 'audio/mp4',
};

const MUSIC = process.env.HOF_NAPPLET_MUSIC ?? 'stereo';
if (!['stereo', 'none'].includes(MUSIC)) {
  throw new Error(`HOF_NAPPLET_MUSIC must be stereo or none (got ${MUSIC})`);
}

// Module path in the web build -> its napplet replacement.
const SWAPS = new Map<string, string>([
  [join(SRC, 'kv.ts'), join(SRC, 'napplet/kv.ts')],
  [join(SRC, 'asset-url.ts'), join(SRC, 'napplet/asset-url.ts')],
  [join(SRC, 'nostr.ts'), join(SRC, 'napplet/nostr.ts')],
  [join(SRC, 'bitcoin.ts'), join(SRC, 'napplet/bitcoin.ts')],
]);

function swapModules(): Plugin {
  return {
    name: 'hof-napplet-swaps',
    enforce: 'pre',
    async resolveId(source, importer, options) {
      if (source === '@forgesworn/joystick-protocol/browser') return join(SRC, 'napplet/joystick-browser.ts');
      if (!importer || importer.startsWith(join(SRC, 'napplet') + '/')) return null;
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
      return (resolved && SWAPS.get(resolved.id)) ?? null;
    },
  };
}

/** Every literal assetUrl('...') path in the game source. */
function referencedAssets(): string[] {
  const paths = new Set<string>();
  for (const name of readdirSync(SRC)) {
    if (!name.endsWith('.ts') || name.endsWith('.test.ts')) continue;
    for (const match of readFileSync(join(SRC, name), 'utf8').matchAll(/assetUrl\('([^']+)'\)/g)) {
      paths.add(match[1]);
    }
  }
  return [...paths].filter(path => [...PACKED_DIRS, 'music/'].some(dir => path.startsWith(dir))).sort();
}

// Apple's AudioToolbox AAC encoder sounds better than ffmpeg's built-in one at
// this bitrate; use it where ffmpeg was built with it.
const AAC_ENCODER = (() => {
  try { return execFileSync('ffmpeg', ['-hide_banner', '-encoders'], { encoding: 'utf8' }).includes(' aac_at ') ? 'aac_at' : 'aac'; }
  catch { return 'aac'; }
})();

function encodeMusic(file: string): string {
  mkdirSync(MUSIC_CACHE, { recursive: true });
  const out = join(MUSIC_CACHE, `${basename(file, '.m4a')}-${AAC_ENCODER}-96k-${statSync(file).mtimeMs}.m4a`);
  if (!existsSync(out)) {
    try {
      execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', file, '-vn', '-c:a', AAC_ENCODER, '-b:a', '96k', out]);
    } catch (error) {
      throw new Error(`napplet music needs ffmpeg on PATH (or set HOF_NAPPLET_MUSIC=none): ${String(error)}`);
    }
  }
  return out;
}

interface ExternalAsset {
  id: string;
  file: string;
  sha256: string;
  bytes: number;
}

function sha256(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

function writeExternal(id: string, file: string, data: Buffer, out: ExternalAsset[]): string {
  if (data.length > MAX_EXTERNAL_BYTES) throw new Error(`${file} is ${data.length} bytes; external assets must stay under 10 MiB`);
  writeFileSync(join(ASSETS_OUT, file), data);
  const hash = sha256(data);
  out.push({ id, file, sha256: hash, bytes: data.length });
  return hash;
}

/** Pack format: "HOFP", uint32 LE index length, JSON index, then the files. */
function buildPack(paths: string[]): Buffer {
  const parts: Buffer[] = [];
  const index: Array<{ path: string; mime: string; offset: number; length: number }> = [];
  let offset = 0;
  for (const path of paths) {
    const data = readFileSync(join(PUBLIC, path));
    index.push({ path, mime: MIME[extname(path)] ?? 'application/octet-stream', offset, length: data.length });
    parts.push(data);
    offset += data.length;
  }
  const json = Buffer.from(JSON.stringify(index));
  const header = Buffer.alloc(8);
  header.write('HOFP', 0, 'latin1');
  header.writeUInt32LE(json.length, 4);
  return Buffer.concat([header, json, ...parts]);
}

function externalAssets(): Plugin {
  return {
    name: 'hof-napplet-assets',
    resolveId(id) {
      return id === ASSET_MODULE ? `\0${ASSET_MODULE}` : null;
    },
    load(id) {
      if (id !== `\0${ASSET_MODULE}`) return null;
      rmSync(ASSETS_OUT, { recursive: true, force: true });
      mkdirSync(ASSETS_OUT, { recursive: true });
      const listed: ExternalAsset[] = [];
      const paths = referencedAssets();
      const packHash = writeExternal('art-pack', 'art.hofpack', buildPack(paths.filter(path => !path.startsWith('music/'))), listed);
      const external: Record<string, { sha256: string; mime: string }> = {};
      if (MUSIC !== 'none') {
        for (const path of paths.filter(path => path.startsWith('music/'))) {
          const name = basename(path, '.m4a');
          const hash = writeExternal(`music-${name}`, `${name}.m4a`, readFileSync(encodeMusic(join(PUBLIC, path))), listed);
          external[path] = { sha256: hash, mime: 'audio/mp4' };
        }
      }
      writeFileSync(join(ASSETS_OUT, 'assets.json'), `${JSON.stringify(listed, null, 2)}\n`);
      const total = listed.reduce((sum, asset) => sum + asset.bytes, 0);
      this.info(`${listed.length} external assets, ${(total / 1048576).toFixed(1)} MiB, in dist-napplet-assets/ (music: ${MUSIC})`);
      return `export default ${JSON.stringify({ pack: { sha256: packHash }, external })};`;
    },
  };
}

function dataUri(path: string): string {
  return `data:${MIME[extname(path)]};base64,${readFileSync(join(PUBLIC, path)).toString('base64')}`;
}

/** Point index.html at the napplet entry and inline or drop everything it
 *  loaded from public/ (there is no origin to serve it from). */
function nappletHtml(): Plugin {
  return {
    name: 'hof-napplet-html',
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        const out = html
          .replace('src="/src/main.ts"', 'src="/src/napplet/boot.ts"')
          .replace(/\s*<link rel="(?:manifest|icon|apple-touch-icon)"[^>]*>/g, '')
          .replace(/<meta name="(?:apple-mobile-web-app-[a-z-]+|mobile-web-app-capable)"[^>]*>\s*/g, '')
          .replace(/(<img\b[^>]*\bsrc=")%BASE_URL%([^"]+)"/g, (_m, tag: string, path: string) => `${tag}${dataUri(path)}"`)
          .replace('<body>', '<body>\n  <div id="napplet-loading" style="position:fixed;inset:0;display:grid;place-items:center;color:#ffd76b;font:700 18px sans-serif;letter-spacing:2px">LOADING…</div>');
        const left = out.match(/%BASE_URL%[^"]*/g);
        if (left) throw new Error(`index.html still loads from public/ in the napplet build: ${left.join(', ')}`);
        return out;
      },
    },
  };
}

export default defineConfig({
  mode: 'napplet',
  publicDir: false,
  plugins: [
    swapModules(),
    externalAssets(),
    nappletHtml(),
    nip5aManifest({
      nappletType: 'hang-on-fren',
      title: 'Hang On, Fren',
      description: 'A Riviera Vespa road tribute starring DNI. Grab roses, cross ten regions, and reach the finish line before time runs out.',
      source: 'https://github.com/TheCryptoDonkey/hang-on-fren-public',
      requires: ['resource'],
      optional: ['storage'],
      icon: { data: readFileSync(join(PUBLIC, 'icons/icon-192.png')), mimeType: 'image/png' },
      artifactMode: 'single-file',
    }),
  ],
  build: {
    outDir: 'dist-napplet',
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: false,
    // Vite's module-preload polyfill calls fetch; one inlined entry needs no
    // preload graph.
    modulePreload: { polyfill: false },
  },
});
