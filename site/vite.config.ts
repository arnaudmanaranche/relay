import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The site is served from https://arnaudmanaranche.github.io/relay/, so every
// emitted asset URL has to carry that prefix. `outDir` points at the repo's
// docs/ folder because that is the directory GitHub Pages is configured to
// serve — the build output is committed, and docs/ is never hand-edited.
export default defineConfig({
  base: '/relay/',
  plugins: [react()],
  build: {
    outDir: '../docs',
    emptyOutDir: true,
    assetsInlineLimit: 0,
  },
});
