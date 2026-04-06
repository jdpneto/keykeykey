import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, readdirSync } from 'fs';
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
    manifest.content_scripts[0].js = ['content/index.js']; // Content script is built to content/

    // Copy icon files to dist
    const iconsDir = resolve(__dirname, 'icons');
    const distIconsDir = resolve(__dirname, 'dist/icons');
    mkdirSync(distIconsDir, { recursive: true });
    for (const file of readdirSync(iconsDir)) {
      if (file.endsWith('.png')) {
        copyFileSync(resolve(iconsDir, file), resolve(distIconsDir, file));
      }
    }

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
        content: 'src/content/index.ts',
        offscreen: 'src/offscreen/clipboard-clear.html',
      },
      output: {
        entryFileNames: '[name]/index.js',
      },
    },
  },
});
