import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { copyFileSync } from 'fs';
import { resolve } from 'path';

// Copy manifest.json to dist after build (required for extension loading)
const copyManifest = (): import('vite').Plugin => ({
  name: 'copy-manifest',
  closeBundle() {
    copyFileSync(resolve(__dirname, 'manifest.json'), resolve(__dirname, 'dist/manifest.json'));
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
