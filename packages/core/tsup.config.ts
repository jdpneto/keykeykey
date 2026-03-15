import { defineConfig } from 'tsup';

export default defineConfig({
  entry: [
    'src/index.ts',
    'src/crypto/index.ts',
    'src/models/index.ts',
    'src/store/index.ts',
    'src/sync/index.ts',
    'src/generator/index.ts',
    'src/domain/index.ts',
    'src/pin/index.ts',
  ],
  format: ['esm'],
  dts: true,
  splitting: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
});
