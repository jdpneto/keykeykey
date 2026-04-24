const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

// Find the monorepo root (two levels up from apps/mobile)
const monorepoRoot = path.resolve(__dirname, '../..');

const config = getDefaultConfig(__dirname);

// Explicitly set the project root to this directory (apps/mobile)
config.projectRoot = __dirname;

// Honor package.json `exports` fields. Required for ESM-only deps like
// uuid@14 which expose no `main` — only `exports`. Without this, Metro's
// legacy resolver reads `main` (undefined) and fails with
// "package specifies a `main` module field that could not be resolved".
config.resolver.unstable_enablePackageExports = true;

// Watch the entire monorepo so Metro can resolve workspace packages
config.watchFolders = [monorepoRoot];

// Ensure node_modules resolve correctly in a pnpm monorepo
config.resolver.nodeModulesPaths = [
  path.resolve(__dirname, 'node_modules'),
  path.resolve(monorepoRoot, 'node_modules'),
];

// Singleton packages that must always resolve to the app's copy
const singletonPackages = {
  react: path.resolve(__dirname, 'node_modules/react'),
  'react-native': path.resolve(__dirname, 'node_modules/react-native'),
  'react/jsx-runtime': path.resolve(__dirname, 'node_modules/react/jsx-runtime'),
  'react/jsx-dev-runtime': path.resolve(__dirname, 'node_modules/react/jsx-dev-runtime'),
};

// Resolve workspace packages to their TypeScript source (Metro handles transpilation)
config.resolver.resolveRequest = (context, moduleName, platform) => {
  // Force singleton packages to resolve from the app's node_modules
  if (singletonPackages[moduleName]) {
    return {
      filePath: require.resolve(singletonPackages[moduleName]),
      type: 'sourceFile',
    };
  }
  if (moduleName === '@keykeykey/core') {
    return {
      filePath: path.resolve(monorepoRoot, 'packages/core/src/index.ts'),
      type: 'sourceFile',
    };
  }
  if (moduleName.startsWith('@keykeykey/core/')) {
    const subpath = moduleName.replace('@keykeykey/core/', '');
    return {
      filePath: path.resolve(monorepoRoot, `packages/core/src/${subpath}/index.ts`),
      type: 'sourceFile',
    };
  }
  if (moduleName === '@keykeykey/ui') {
    return {
      filePath: path.resolve(monorepoRoot, 'packages/ui/src/index.ts'),
      type: 'sourceFile',
    };
  }
  // Handle .js → .ts remapping for workspace packages using TypeScript ESM imports
  if (moduleName.endsWith('.js')) {
    const caller = context.originModulePath || '';
    if (caller.includes('/packages/')) {
      const tsModuleName = moduleName.replace(/\.js$/, '.ts');
      try {
        return context.resolveRequest(context, tsModuleName, platform);
      } catch {
        // Fall through to default resolution
      }
    }
  }

  // Fall back to default resolution
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
