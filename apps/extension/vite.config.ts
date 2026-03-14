import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

// Copy manifest.json to dist with paths rewritten for built output
const copyManifest = (): import('vite').Plugin => ({
  name: 'copy-manifest',
  closeBundle() {
    const src = resolve(__dirname, 'manifest.json');
    const dest = resolve(__dirname, 'dist/manifest.json');
    const manifest = JSON.parse(readFileSync(src, 'utf-8'));

    // Rewrite paths for built output
    manifest.action.default_popup = 'src/popup/index.html'; // HTML stays in src/popup/
    manifest.background.service_worker = 'background/index.js'; // JS is built to background/

    // Remove icons if the icon files don't exist in dist
    delete manifest.icons;

    writeFileSync(dest, JSON.stringify(manifest, null, 2));
  },
});

export default defineConfig({
  plugins: [react(), copyManifest()],
  build: {
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      input: {
        popup: 'src/popup/index.html',
        background: 'src/background/index.ts',
        offscreen: 'src/offscreen/clipboard-clear.html',
      },
      output: {
        entryFileNames: '[name]/index.js',
      },
    },
  },
});
