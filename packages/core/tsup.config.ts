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
    'src/biometric/index.ts',
    'src/unlock/index.ts',
    'src/utils/index.ts',
    'src/export/index.ts',
    'src/import/index.ts',
    'src/export-import-zip/index.ts',
    'src/totp/index.ts',
  ],
  format: ['esm'],
  // tsup 8.5's DTS build always injects `baseUrl` into the compiler options,
  // which TypeScript 6 reports as deprecated (TS5101). Our tsconfigs don't use
  // `baseUrl`; acknowledge the deprecation for tsup's injected option only.
  dts: { compilerOptions: { ignoreDeprecations: '6.0' } },
  splitting: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
});
