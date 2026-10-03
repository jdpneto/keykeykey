import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/tokens/index.ts', 'src/components/sync-settings/index.ts'],
  format: ['esm'],
  // See packages/core/tsup.config.ts: tsup injects a deprecated `baseUrl`.
  dts: { compilerOptions: { ignoreDeprecations: '6.0' } },
  splitting: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  external: ['react'],
});
