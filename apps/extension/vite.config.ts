import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, readdirSync } from 'fs';
import { resolve } from 'path';

type Target = 'chrome' | 'firefox';
const TARGET: Target = (process.env.EXT_TARGET as Target) || 'chrome';

if (TARGET !== 'chrome' && TARGET !== 'firefox') {
  throw new Error(`Invalid EXT_TARGET="${TARGET}" — must be "chrome" or "firefox"`);
}

const OUT_DIR = `dist-${TARGET}`;

/**
 * Recursively merge `overrides` into `base`. Arrays in `overrides` replace the
 * corresponding array in `base` (no element-wise merging). Plain objects are
 * deeply merged. Scalars are replaced.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function deepMerge(base: any, overrides: any): any {
  if (Array.isArray(overrides)) return overrides;
  if (overrides === null || typeof overrides !== 'object') return overrides;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const out: Record<string, any> = { ...(base ?? {}) };
  for (const [key, value] of Object.entries(overrides)) {
    out[key] = key in out ? deepMerge(out[key], value) : value;
  }
  return out;
}

// Copy base + per-target manifest overrides, rewrite built paths, copy icons
const copyManifest = (): import('vite').Plugin => ({
  name: 'copy-manifest',
  closeBundle() {
    const basePath = resolve(__dirname, 'manifest.json');
    const overridesPath = resolve(__dirname, `manifest.${TARGET}.json`);
    const base = JSON.parse(readFileSync(basePath, 'utf-8'));
    const overrides = JSON.parse(readFileSync(overridesPath, 'utf-8'));
    const manifest = deepMerge(base, overrides);

    // Rewrite paths for built output (mirrors what the old plugin did)
    manifest.action.default_popup = 'src/popup/index.html';
    if (manifest.background?.service_worker) {
      manifest.background.service_worker = 'background/index.js';
    }
    if (manifest.background?.scripts) {
      manifest.background.scripts = ['background/index.js'];
    }
    if (manifest.content_scripts?.[0]) {
      manifest.content_scripts[0].js = ['content/index.js'];
    }

    // Copy icons into the target dist
    const iconsDir = resolve(__dirname, 'icons');
    const distIconsDir = resolve(__dirname, `${OUT_DIR}/icons`);
    mkdirSync(distIconsDir, { recursive: true });
    for (const file of readdirSync(iconsDir)) {
      if (file.endsWith('.png')) {
        copyFileSync(resolve(iconsDir, file), resolve(distIconsDir, file));
      }
    }

    const dest = resolve(__dirname, `${OUT_DIR}/manifest.json`);
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
        outDir: `${OUT_DIR}/content`,
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
    outDir: OUT_DIR,
    sourcemap: true,
    rollupOptions: {
      input: {
        popup: 'src/popup/index.html',
        background: 'src/background/index.ts',
        // offscreen is Chrome-only — Firefox clears the clipboard from the
        // background event page directly via navigator.clipboard.writeText().
        ...(TARGET === 'chrome'
          ? { offscreen: 'src/offscreen/clipboard-clear.html' }
          : {}),
      },
      output: {
        entryFileNames: '[name]/index.js',
      },
    },
  },
});
