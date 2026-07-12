import { defineConfig } from 'vite';

// Bundles the one-off gamestr migration (server/migrate-gamestr.ts) into a
// self-contained server-dist/migrate-gamestr.js for running on the VPS.
export default defineConfig({
  build: {
    ssr: 'server/migrate-gamestr.ts',
    target: 'node22',
    outDir: 'server-dist',
    emptyOutDir: false,
    sourcemap: false,
    rollupOptions: {
      output: {
        entryFileNames: 'migrate-gamestr.js',
      },
    },
  },
  ssr: {
    noExternal: true,
  },
});
