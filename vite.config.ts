import { defineConfig, type Plugin } from 'vite';
import {readFileSync} from 'node:fs';

// Build stamp baked into the bundle and published as /version.json so a running
// tab can detect a newer deploy. Mirrors neon-sentinel's convention.
const SOURCE_REVISION = process.env.HOF_SOURCE_REVISION;
if (SOURCE_REVISION !== undefined && !/^[a-f0-9]{40}$/.test(SOURCE_REVISION)) {
  throw new Error('HOF_SOURCE_REVISION must be a full Git revision');
}

const BUILD_ID = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);

function versionStamp(): Plugin {
  return {
    name: 'hang-on-fren-version-stamp',
    apply: 'build',
    generateBundle() {
      this.emitFile({type:'asset',fileName:'game.json',source:readFileSync(new URL('./game.json',import.meta.url),'utf8')});
      this.emitFile({ type: 'asset', fileName: 'version.json', source: `${JSON.stringify({ build: BUILD_ID, ...(SOURCE_REVISION ? { revision: SOURCE_REVISION } : {}) })}\n` });
    },
  };
}

export default defineConfig({
  plugins: [versionStamp()],
  define: {
    __BUILD_ID__: JSON.stringify(BUILD_ID),
  },
  server: {
    port: 5191,
    host: true,
    // Dev claim service (server/index.ts) — run it with `npm run dev:api`.
    // changeOrigin must stay OFF so the original Host header reaches the
    // service: NIP-98 auth validates the URL the browser actually signed.
    proxy: {
      '/api': { target: 'http://127.0.0.1:3191', changeOrigin: false },
    },
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
});
