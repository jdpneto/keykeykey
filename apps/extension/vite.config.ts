import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Note: CRXJS Vite plugin v3 for Manifest V3 support.
// Import will be: import crx from '@crxjs/vite-plugin';
// Once the beta stabilizes, add: crx({ manifest }) to plugins array.

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      input: {
        popup: 'src/popup/index.html',
        background: 'src/background/index.ts',
        content: 'src/content/index.ts',
      },
      output: {
        entryFileNames: '[name]/index.js',
      },
    },
  },
});
