import { defineConfig } from 'vite';

// Bundles the claim service into a single self-contained server-dist/index.js
// (nostr-tools inlined), so the VPS just needs node — no npm install there.
export default defineConfig({
  build: {
    ssr: 'server/index.ts',
    target: 'node22',
    outDir: 'server-dist',
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      output: {
        entryFileNames: 'index.js',
      },
    },
  },
  ssr: {
    noExternal: true,
  },
});
