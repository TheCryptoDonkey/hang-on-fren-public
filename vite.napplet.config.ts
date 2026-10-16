// Napplet edition build (NIP-5D): one self-contained index.html in
// dist-napplet/, for napplet.soy and other napplet shells. The web build
// (vite.config.ts) is untouched; this config swaps the modules that need
// network access, browser storage or the arcade window for napplet versions
// in src/napplet/, and inlines every asset the game passes to assetUrl().
//
// HOF_NAPPLET_MUSIC chooses the soundtrack: 'lite' (default) re-encodes the
// beds as 96 kbps stereo AAC with ffmpeg, 'full' inlines the originals (~22 MB
// before base64), 'none' ships the game without music.
import { defineConfig, type Plugin } from 'vite';
import { nip5aManifest } from '@napplet/vite-plugin';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname);
const SRC = join(ROOT, 'src');
const PUBLIC = join(ROOT, 'public');
const MUSIC_CACHE = join(ROOT, 'node_modules/.cache/hof-napplet-music');
const ASSET_MODULE = 'virtual:hof-napplet-assets';
const INLINED_DIRS = ['art/', 'pickups/', 'sfx/', 'music/'];
const MIME: Record<string, string> = {
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.m4a': 'audio/mp4',
};

type MusicMode = 'lite' | 'full' | 'none';
const MUSIC = (process.env.HOF_NAPPLET_MUSIC ?? 'lite') as MusicMode;
if (!['lite', 'full', 'none'].includes(MUSIC)) {
  throw new Error(`HOF_NAPPLET_MUSIC must be lite, full or none (got ${MUSIC})`);
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
  return [...paths].filter(path => INLINED_DIRS.some(dir => path.startsWith(dir))).sort();
}

// Apple's AudioToolbox AAC encoder sounds better than ffmpeg's built-in one at
// this bitrate; use it where ffmpeg was built with it.
const AAC_ENCODER = (() => {
  try { return execFileSync('ffmpeg', ['-hide_banner', '-encoders'], { encoding: 'utf8' }).includes(' aac_at ') ? 'aac_at' : 'aac'; }
  catch { return 'aac'; }
})();

function liteMusic(file: string): string {
  mkdirSync(MUSIC_CACHE, { recursive: true });
  const out = join(MUSIC_CACHE, `${basename(file, '.m4a')}-${AAC_ENCODER}-96k-${statSync(file).mtimeMs}.m4a`);
  if (!existsSync(out)) {
    try {
      execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', file, '-vn', '-c:a', AAC_ENCODER, '-b:a', '96k', out]);
    } catch (error) {
      throw new Error(`HOF_NAPPLET_MUSIC=lite needs ffmpeg on PATH (or set HOF_NAPPLET_MUSIC=full|none): ${String(error)}`);
    }
  }
  return out;
}

function inlineAssets(): Plugin {
  return {
    name: 'hof-napplet-assets',
    resolveId(id) {
      return id === ASSET_MODULE ? `\0${ASSET_MODULE}` : null;
    },
    load(id) {
      if (id !== `\0${ASSET_MODULE}`) return null;
      const entries: Record<string, { mime: string; base64: string }> = {};
      let bytes = 0;
      for (const path of referencedAssets()) {
        const isMusic = path.startsWith('music/');
        if (isMusic && MUSIC === 'none') continue;
        const source = join(PUBLIC, path);
        const file = isMusic && MUSIC === 'lite' ? liteMusic(source) : source;
        const data = readFileSync(file);
        bytes += data.length;
        entries[path] = { mime: MIME[extname(path)] ?? 'application/octet-stream', base64: data.toString('base64') };
      }
      this.info(`inlined ${Object.keys(entries).length} assets, ${(bytes / 1048576).toFixed(1)} MiB before base64 (music: ${MUSIC})`);
      return `export default ${JSON.stringify(entries)};`;
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
          .replace(/(<img\b[^>]*\bsrc=")%BASE_URL%([^"]+)"/g, (_m, tag: string, path: string) => `${tag}${dataUri(path)}"`);
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
    inlineAssets(),
    nappletHtml(),
    nip5aManifest({
      nappletType: 'hang-on-fren',
      title: 'Hang On, Fren',
      description: 'A Riviera Vespa road tribute starring DNI. Grab roses, cross ten regions, and reach the finish line before time runs out.',
      source: 'https://github.com/TheCryptoDonkey/hang-on-fren-public',
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
