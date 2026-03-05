import { defineConfig } from 'tsup';

export default defineConfig({
  entry: [
    'src/index.ts',
    'src/crypto/index.ts',
    'src/models/index.ts',
    'src/store/index.ts',
    'src/sync/index.ts',
  ],
  format: ['esm'],
  dts: true,
  splitting: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
});
