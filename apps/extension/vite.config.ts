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

// Content script must be built as IIFE (not ES module) because MV3 content
// scripts don't support `import` statements. We build it separately via a
// plugin that runs a second Vite build after the main build completes.
const buildContentScript = (): import('vite').Plugin => ({
  name: 'build-content-script',
  async closeBundle() {
    const { build } = await import('vite');
    await build({
      configFile: false,
      build: {
        outDir: 'dist/content',
        sourcemap: true,
        emptyOutDir: false,
        lib: {
          entry: resolve(__dirname, 'src/content/index.ts'),
          formats: ['iife'],
          name: 'KeyKeyKeyContent',
          fileName: () => 'index.js',
        },
        rollupOptions: {
          output: {
            // Inline all dependencies — content scripts can't load separate chunks
            inlineDynamicImports: true,
          },
        },
      },
    });
  },
});

export default defineConfig({
  plugins: [react(), copyManifest(), buildContentScript()],
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
