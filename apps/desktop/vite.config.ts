import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
  envPrefix: ['VITE_', 'TAURI_'],
  build: {
    target: 'esnext',
    // Vite 8's default minifier (Oxc); esbuild is no longer bundled with Vite.
    minify: !process.env.TAURI_DEBUG,
    sourcemap: !!process.env.TAURI_DEBUG,
    rolldownOptions: {
      output: {
        // Split the large third-party libraries into their own chunks so no
        // single chunk exceeds Vite's 500 kB warning threshold.
        codeSplitting: {
          groups: [
            {
              name: 'vendor-react',
              test: /[\\/]node_modules[\\/](react|react-dom|react-router|react-router-dom|scheduler)[\\/]/,
            },
            { name: 'vendor-zod', test: /[\\/]node_modules[\\/]zod[\\/]/ },
            { name: 'vendor-tldts', test: /[\\/]node_modules[\\/](tldts|tldts-core)[\\/]/ },
          ],
        },
      },
    },
  },
});
