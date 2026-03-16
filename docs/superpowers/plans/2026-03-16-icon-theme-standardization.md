# Icon Standardization & Theme Consistency Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Standardize the app icon to "three overlapping keys" across all platforms, fix CSS token drift in the extension, and add a theme toggle to mobile.

**Architecture:** Master SVG at repo root generates all platform raster icons. Extension CSS aligns to shared `@keykeykey/ui` tokens. Mobile gets a new `ThemeProvider` (context + AsyncStorage) matching the desktop/extension pattern, with all 16 consumer files migrated.

**Tech Stack:** SVG, sharp (PNG generation), React Native (AsyncStorage, useColorScheme), Vite plugin (file copy), CSS variables.

**Spec:** `docs/superpowers/specs/2026-03-16-icon-theme-standardization-design.md`

---

## Chunk 1: Master Icon & Platform Icons

### Task 1: Create master SVG icon

**Files:**

- Create: `assets/icon-master.svg`

- [ ] **Step 1: Create the assets directory and master SVG**

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="200" height="200">
  <rect x="5" y="5" width="190" height="190" rx="40" fill="#1C1917"/>
  <!-- Key 1 (left) -->
  <g transform="translate(36,48)" opacity="0.85">
    <circle cx="18" cy="18" r="15" fill="#A3E635" stroke="#65A30D" stroke-width="2"/>
    <circle cx="18" cy="18" r="5.5" fill="#1C1917"/>
    <rect x="14.5" y="33" width="7" height="52" rx="3.5" fill="#A3E635" stroke="#65A30D" stroke-width="2"/>
    <rect x="21.5" y="60" width="14" height="6" rx="3" fill="#A3E635" stroke="#65A30D" stroke-width="2"/>
    <rect x="21.5" y="70" width="10" height="6" rx="3" fill="#A3E635" stroke="#65A30D" stroke-width="2"/>
  </g>
  <!-- Key 2 (center, taller, in front) -->
  <g transform="translate(78,38)">
    <circle cx="18" cy="18" r="15" fill="#84CC16" stroke="#4D7C0F" stroke-width="2"/>
    <circle cx="18" cy="18" r="5.5" fill="#1C1917"/>
    <rect x="14.5" y="33" width="7" height="62" rx="3.5" fill="#84CC16" stroke="#4D7C0F" stroke-width="2"/>
    <rect x="21.5" y="68" width="14" height="6" rx="3" fill="#84CC16" stroke="#4D7C0F" stroke-width="2"/>
    <rect x="21.5" y="79" width="10" height="6" rx="3" fill="#84CC16" stroke="#4D7C0F" stroke-width="2"/>
  </g>
  <!-- Key 3 (right) -->
  <g transform="translate(120,48)" opacity="0.85">
    <circle cx="18" cy="18" r="15" fill="#A3E635" stroke="#65A30D" stroke-width="2"/>
    <circle cx="18" cy="18" r="5.5" fill="#1C1917"/>
    <rect x="14.5" y="33" width="7" height="52" rx="3.5" fill="#A3E635" stroke="#65A30D" stroke-width="2"/>
    <rect x="21.5" y="60" width="14" height="6" rx="3" fill="#A3E635" stroke="#65A30D" stroke-width="2"/>
    <rect x="21.5" y="70" width="10" height="6" rx="3" fill="#A3E635" stroke="#65A30D" stroke-width="2"/>
  </g>
</svg>
```

- [ ] **Step 2: Create simplified keys-only SVG for 16px extension toolbar**

Create `assets/icon-keys-only.svg` — same three keys but without the rounded-square background (transparent background). This is used only for the 16px extension toolbar icon where the background would be invisible at that size.

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="200" height="200">
  <!-- Key 1 (left) -->
  <g transform="translate(36,48)" opacity="0.85">
    <circle cx="18" cy="18" r="15" fill="#A3E635" stroke="#65A30D" stroke-width="2"/>
    <circle cx="18" cy="18" r="5.5" fill="#FFFFFF"/>
    <rect x="14.5" y="33" width="7" height="52" rx="3.5" fill="#A3E635" stroke="#65A30D" stroke-width="2"/>
    <rect x="21.5" y="60" width="14" height="6" rx="3" fill="#A3E635" stroke="#65A30D" stroke-width="2"/>
    <rect x="21.5" y="70" width="10" height="6" rx="3" fill="#A3E635" stroke="#65A30D" stroke-width="2"/>
  </g>
  <!-- Key 2 (center, taller, in front) -->
  <g transform="translate(78,38)">
    <circle cx="18" cy="18" r="15" fill="#84CC16" stroke="#4D7C0F" stroke-width="2"/>
    <circle cx="18" cy="18" r="5.5" fill="#FFFFFF"/>
    <rect x="14.5" y="33" width="7" height="62" rx="3.5" fill="#84CC16" stroke="#4D7C0F" stroke-width="2"/>
    <rect x="21.5" y="68" width="14" height="6" rx="3" fill="#84CC16" stroke="#4D7C0F" stroke-width="2"/>
    <rect x="21.5" y="79" width="10" height="6" rx="3" fill="#84CC16" stroke="#4D7C0F" stroke-width="2"/>
  </g>
  <!-- Key 3 (right) -->
  <g transform="translate(120,48)" opacity="0.85">
    <circle cx="18" cy="18" r="15" fill="#A3E635" stroke="#65A30D" stroke-width="2"/>
    <circle cx="18" cy="18" r="5.5" fill="#FFFFFF"/>
    <rect x="14.5" y="33" width="7" height="52" rx="3.5" fill="#A3E635" stroke="#65A30D" stroke-width="2"/>
    <rect x="21.5" y="60" width="14" height="6" rx="3" fill="#A3E635" stroke="#65A30D" stroke-width="2"/>
    <rect x="21.5" y="70" width="10" height="6" rx="3" fill="#A3E635" stroke="#65A30D" stroke-width="2"/>
  </g>
</svg>
```

- [ ] **Step 3: Commit**

```bash
git add assets/icon-master.svg assets/icon-keys-only.svg
git commit -m "feat: add master SVG icons for three-keys design"
```

### Task 2: Generate and deploy platform icons

**Files:**

- Create: `scripts/generate-icons.mjs`
- Modify: `apps/mobile/assets/icon.png`
- Modify: `apps/desktop/src-tauri/icons/` (all files)
- Create: `apps/extension/icons/icon-16.png`, `icon-48.png`, `icon-128.png`

- [ ] **Step 1: Create icon generation script**

Create `scripts/generate-icons.mjs` using `sharp` (already available or install as devDependency). This script:

1. Reads `assets/icon-master.svg` and renders PNG at sizes: 1024, 512, 310, 284, 150, 142, 128, 107, 89, 71, 64, 48, 44, 32, 30, 16
2. Reads `assets/icon-keys-only.svg` and renders PNG at 16px
3. Copies outputs to the correct platform paths

```javascript
import sharp from 'sharp';
import { mkdirSync, copyFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

const masterSvg = resolve(root, 'assets/icon-master.svg');
const keysOnlySvg = resolve(root, 'assets/icon-keys-only.svg');

async function render(svgPath, size, outPath) {
  mkdirSync(dirname(outPath), { recursive: true });
  await sharp(svgPath).resize(size, size).png().toFile(outPath);
  console.log(`  ${size}x${size} → ${outPath}`);
}

async function main() {
  console.log('Generating icons from master SVG...\n');

  // Mobile (Expo) — 1024x1024
  await render(masterSvg, 1024, resolve(root, 'apps/mobile/assets/icon.png'));

  // Desktop (Tauri) — main icons
  const tauriIcons = resolve(root, 'apps/desktop/src-tauri/icons');
  await render(masterSvg, 512, resolve(tauriIcons, 'icon.png'));
  await render(masterSvg, 256, resolve(tauriIcons, '128x128@2x.png'));
  await render(masterSvg, 128, resolve(tauriIcons, '128x128.png'));
  await render(masterSvg, 64, resolve(tauriIcons, '64x64.png'));
  await render(masterSvg, 32, resolve(tauriIcons, '32x32.png'));

  // Desktop — Windows Store squares
  for (const size of [310, 284, 150, 142, 107, 89, 71, 44, 30]) {
    await render(masterSvg, size, resolve(tauriIcons, `Square${size}x${size}Logo.png`));
  }
  await render(masterSvg, 50, resolve(tauriIcons, 'StoreLogo.png'));

  // Desktop — iOS icons
  const iosDir = resolve(tauriIcons, 'ios');
  const iosSizes = [
    { name: 'AppIcon-20x20@1x.png', size: 20 },
    { name: 'AppIcon-20x20@2x.png', size: 40 },
    { name: 'AppIcon-20x20@3x.png', size: 60 },
    { name: 'AppIcon-29x29@1x.png', size: 29 },
    { name: 'AppIcon-29x29@2x.png', size: 58 },
    { name: 'AppIcon-29x29@3x.png', size: 87 },
    { name: 'AppIcon-40x40@1x.png', size: 40 },
    { name: 'AppIcon-40x40@2x.png', size: 80 },
    { name: 'AppIcon-40x40@3x.png', size: 120 },
    { name: 'AppIcon-60x60@2x.png', size: 120 },
    { name: 'AppIcon-60x60@3x.png', size: 180 },
    { name: 'AppIcon-76x76@1x.png', size: 76 },
    { name: 'AppIcon-76x76@2x.png', size: 152 },
    { name: 'AppIcon-83.5x83.5@2x.png', size: 167 },
    { name: 'AppIcon-512@2x.png', size: 1024 },
  ];
  for (const { name, size } of iosSizes) {
    await render(masterSvg, size, resolve(iosDir, name));
  }

  // Desktop — Android icons
  const androidDir = resolve(tauriIcons, 'android');
  const androidDensities = [
    { dir: 'mipmap-mdpi', size: 48 },
    { dir: 'mipmap-hdpi', size: 72 },
    { dir: 'mipmap-xhdpi', size: 96 },
    { dir: 'mipmap-xxhdpi', size: 144 },
    { dir: 'mipmap-xxxhdpi', size: 192 },
  ];
  for (const { dir, size } of androidDensities) {
    const d = resolve(androidDir, dir);
    await render(masterSvg, size, resolve(d, 'ic_launcher.png'));
    await render(masterSvg, size, resolve(d, 'ic_launcher_round.png'));
    // Foreground is ~108/72 ratio of full icon for adaptive
    await render(masterSvg, size, resolve(d, 'ic_launcher_foreground.png'));
  }

  // Extension icons
  const extIcons = resolve(root, 'apps/extension/icons');
  await render(masterSvg, 128, resolve(extIcons, 'icon-128.png'));
  await render(masterSvg, 48, resolve(extIcons, 'icon-48.png'));
  await render(keysOnlySvg, 16, resolve(extIcons, 'icon-16.png'));

  // Generate .ico (Windows) — requires multiple sizes embedded
  const icoSizes = [16, 32, 48, 64, 128, 256];
  const icoBuffers = await Promise.all(
    icoSizes.map((s) => sharp(masterSvg).resize(s, s).png().toBuffer()),
  );
  // For .ico generation, use sharp to create the largest size
  // and note that proper .ico generation may need a dedicated tool
  // For now, copy the 256px as icon.ico placeholder
  await render(masterSvg, 256, resolve(tauriIcons, 'icon.ico'));

  // Generate .icns (macOS) — sharp can't do this natively
  // Copy the 512px as a placeholder; proper .icns needs iconutil on macOS
  await render(masterSvg, 512, resolve(tauriIcons, 'icon.icns'));

  console.log('\nDone! Note: icon.ico and icon.icns are PNG placeholders.');
  console.log('For production, generate proper .ico/.icns using platform tools:');
  console.log('  macOS: iconutil --convert icns iconset.iconset');
  console.log('  Windows: use an ICO conversion tool on the PNGs');
}

main().catch(console.error);
```

- [ ] **Step 2: Install sharp as dev dependency and run the script**

```bash
pnpm add -Dw sharp
node scripts/generate-icons.mjs
```

Verify output files exist at all expected paths.

- [ ] **Step 3: Update mobile app.json background colors**

In `apps/mobile/app.json`, change:

- `expo.splash.backgroundColor` from `"#A3E635"` to `"#1C1917"`
- `expo.android.adaptiveIcon.backgroundColor` from `"#A3E635"` to `"#1C1917"`

- [ ] **Step 4: Update desktop Android adaptive icon background**

In `apps/desktop/src-tauri/icons/android/values/ic_launcher_background.xml`, change:

```xml
<color name="ic_launcher_background">#1C1917</color>
```

- [ ] **Step 5: Commit**

```bash
git add scripts/generate-icons.mjs apps/mobile/assets/ apps/mobile/app.json apps/desktop/src-tauri/icons/ apps/extension/icons/
git commit -m "feat: generate standardized three-keys icon for all platforms"
```

### Task 3: Fix extension vite config to include icons in build

**Files:**

- Modify: `apps/extension/vite.config.ts:7-23`

- [ ] **Step 1: Update the copyManifest plugin**

Replace the `copyManifest` plugin in `apps/extension/vite.config.ts` to:

1. Remove the `delete manifest.icons` line (line 19)
2. Add icon file copying from `icons/` to `dist/icons/`

```typescript
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
```

- [ ] **Step 2: Build extension and verify icons are in dist**

```bash
pnpm --filter @keykeykey/extension build
ls apps/extension/dist/icons/
```

Expected: `icon-16.png  icon-48.png  icon-128.png`

- [ ] **Step 3: Commit**

```bash
git add apps/extension/vite.config.ts
git commit -m "fix(extension): include icon files in build output"
```

---

## Chunk 2: Extension CSS Token Alignment

### Task 4: Fix drifted CSS variables

**Files:**

- Modify: `apps/extension/src/popup/styles/global.css:13-41`

- [ ] **Step 1: Fix light theme values**

In `apps/extension/src/popup/styles/global.css`, in the `[data-theme='light']` block:

- Change `--input-bg: #f5f5f4;` → `--input-bg: #FAFAF9;` (line 21)
- Change `--scrollbar-thumb: #d6d3d1;` → `--scrollbar-thumb: #e7e5e4;` (line 24)

- [ ] **Step 2: Fix dark theme values**

In the `[data-theme='dark']` block:

- Change `--input-bg: #0a3622;` → `--input-bg: #022C22;` (line 36)
- Change `--error: #f87171;` → `--error: #EF4444;` (line 37)
- Change `--success: #4ade80;` → `--success: #22C55E;` (line 38)

- [ ] **Step 3: Run extension tests to verify nothing breaks**

```bash
pnpm --filter @keykeykey/extension test
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add apps/extension/src/popup/styles/global.css
git commit -m "fix(extension): align CSS variables to shared token values"
```

---

## Chunk 3: Mobile Theme Provider & Toggle

### Task 5: Create the ThemeProvider

**Files:**

- Create: `apps/mobile/lib/theme-provider.tsx`
- Modify: `apps/mobile/lib/theme.ts:59-62`

- [ ] **Step 0: Install AsyncStorage dependency**

```bash
pnpm --filter @keykeykey/mobile add @react-native-async-storage/async-storage
```

This package is needed for persisting the user's theme preference across app restarts. The existing Jest `transformIgnorePatterns` already matches `@react-native` which covers `@react-native-async-storage`.

- [ ] **Step 1: Write the failing test for ThemeProvider**

Create `apps/mobile/__tests__/lib/theme-provider.test.tsx`:

```typescript
import React from 'react';
import { renderHook, act } from '@testing-library/react-native';
import { useColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ThemeProvider, useTheme } from '../../lib/theme-provider';

jest.mock('react-native', () => ({
  useColorScheme: jest.fn(),
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
}));

jest.mock('@keykeykey/ui', () => ({
  colors: {
    primary: '#A3E635',
    primaryMuted: '#D9F99D',
    background: '#FFFFFF',
    surface: '#FFF7ED',
    surfaceAlt: '#FFEDD5',
    text: '#292524',
    textSecondary: '#78716C',
    border: '#E7E5E4',
    inputBackground: '#FAFAF9',
    primaryDark: '#A3E635',
    primaryMutedDark: '#365314',
    backgroundDark: '#000000',
    surfaceDark: '#052E16',
    surfaceAltDark: '#064E3B',
    textDark: '#F0FDF4',
    textSecondaryDark: '#86EFAC',
    borderDark: '#14532D',
    inputBackgroundDark: '#022C22',
    error: '#EF4444',
    errorLight: '#FEE2E2',
    success: '#22C55E',
    successLight: '#DCFCE7',
    warning: '#F59E0B',
    warningLight: '#FEF3C7',
    danger: '#DC2626',
  },
  spacing: { xs: 4, sm: 8, md: 16, lg: 24, xl: 32, '2xl': 48 },
  radii: { sm: 6, md: 12, lg: 16, xl: 24, full: 9999 },
  typography: {
    sizes: { xs: 12, sm: 14, md: 16, lg: 18, xl: 22, '2xl': 28, '3xl': 34 },
    weights: { regular: '400', medium: '500', semibold: '600', bold: '700' },
  },
}));

const mockedUseColorScheme = useColorScheme as jest.MockedFunction<typeof useColorScheme>;
const mockedAsyncStorage = AsyncStorage as jest.Mocked<typeof AsyncStorage>;

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <ThemeProvider>{children}</ThemeProvider>
);

describe('ThemeProvider', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedUseColorScheme.mockReturnValue('light');
    mockedAsyncStorage.getItem.mockResolvedValue(null);
  });

  it('defaults to system mode', () => {
    const { result } = renderHook(() => useTheme(), { wrapper });
    expect(result.current.mode).toBe('system');
  });

  it('resolves light theme when system is light and mode is system', () => {
    mockedUseColorScheme.mockReturnValue('light');
    const { result } = renderHook(() => useTheme(), { wrapper });
    expect(result.current.theme.colors.background).toBe('#FFFFFF');
    expect(result.current.isDark).toBe(false);
  });

  it('resolves dark theme when system is dark and mode is system', () => {
    mockedUseColorScheme.mockReturnValue('dark');
    const { result } = renderHook(() => useTheme(), { wrapper });
    expect(result.current.theme.colors.background).toBe('#000000');
    expect(result.current.isDark).toBe(true);
  });

  it('setMode to dark overrides system preference', () => {
    mockedUseColorScheme.mockReturnValue('light');
    const { result } = renderHook(() => useTheme(), { wrapper });

    act(() => {
      result.current.setMode('dark');
    });

    expect(result.current.mode).toBe('dark');
    expect(result.current.theme.colors.background).toBe('#000000');
    expect(result.current.isDark).toBe(true);
  });

  it('setMode to light overrides system preference', () => {
    mockedUseColorScheme.mockReturnValue('dark');
    const { result } = renderHook(() => useTheme(), { wrapper });

    act(() => {
      result.current.setMode('light');
    });

    expect(result.current.mode).toBe('light');
    expect(result.current.theme.colors.background).toBe('#FFFFFF');
    expect(result.current.isDark).toBe(false);
  });

  it('persists mode to AsyncStorage', () => {
    const { result } = renderHook(() => useTheme(), { wrapper });

    act(() => {
      result.current.setMode('dark');
    });

    expect(mockedAsyncStorage.setItem).toHaveBeenCalledWith('keykeykey-theme-mode', 'dark');
  });

  it('throws when useTheme is called outside provider', () => {
    expect(() => {
      renderHook(() => useTheme());
    }).toThrow('useTheme must be used within ThemeProvider');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @keykeykey/mobile test -- --testPathPattern="theme-provider"
```

Expected: FAIL — module `../../lib/theme-provider` not found.

- [ ] **Step 3: Create the ThemeProvider implementation**

Create `apps/mobile/lib/theme-provider.tsx`:

```typescript
import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { lightTheme, darkTheme, type Theme } from './theme';

type ThemeMode = 'light' | 'dark' | 'system';

type ThemeContextType = {
  theme: Theme;
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
  isDark: boolean;
};

const STORAGE_KEY = 'keykeykey-theme-mode';

const ThemeContext = createContext<ThemeContextType | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const systemScheme = useColorScheme();
  const [mode, setModeState] = useState<ThemeMode>('system');

  // Load persisted mode on mount
  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((saved) => {
      if (saved === 'light' || saved === 'dark' || saved === 'system') {
        setModeState(saved);
      }
    });
  }, []);

  const setMode = useCallback((newMode: ThemeMode) => {
    setModeState(newMode);
    AsyncStorage.setItem(STORAGE_KEY, newMode);
  }, []);

  const isDark =
    mode === 'dark' || (mode === 'system' && systemScheme === 'dark');
  const theme = isDark ? darkTheme : lightTheme;

  return (
    <ThemeContext.Provider value={{ theme, mode, setMode, isDark }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextType {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
```

- [ ] **Step 4: Remove useTheme from theme.ts**

In `apps/mobile/lib/theme.ts`:

- Remove the `import { useColorScheme } from 'react-native';` line (line 1)
- Remove the `useTheme()` function (lines 59-62)
- Keep `lightTheme`, `darkTheme`, and `Theme` type exports

After edit, `theme.ts` should be:

```typescript
import { colors, spacing, radii, typography } from '@keykeykey/ui';

export const lightTheme = {
  // ... unchanged ...
} as const;

export const darkTheme = {
  // ... unchanged ...
} as const;

export type Theme = {
  colors: { [K in keyof typeof lightTheme.colors]: string };
  spacing: typeof lightTheme.spacing;
  radii: typeof lightTheme.radii;
  typography: typeof lightTheme.typography;
};
```

- [ ] **Step 5: Run test to verify it passes**

```bash
pnpm --filter @keykeykey/mobile test -- --testPathPattern="theme-provider"
```

Expected: PASS

- [ ] **Step 6: Update existing theme test**

Update `apps/mobile/__tests__/lib/theme.test.ts`:

- Remove the `useTheme` import and all `useTheme` tests (lines 86-127)
- Remove the `useColorScheme` mock (lines 1, 4-6, 44)
- Keep the `lightTheme`/`darkTheme` static tests

- [ ] **Step 7: Run all theme tests**

```bash
pnpm --filter @keykeykey/mobile test -- --testPathPattern="theme"
```

Expected: both `theme.test.ts` and `theme-provider.test.tsx` PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/mobile/lib/theme-provider.tsx apps/mobile/lib/theme.ts apps/mobile/__tests__/lib/theme-provider.test.tsx apps/mobile/__tests__/lib/theme.test.ts
git commit -m "feat(mobile): add ThemeProvider with system/light/dark mode support"
```

### Task 6: Migrate all consumer files

**Files:**

- Modify: 16 files listed below + `apps/mobile/app/_layout.tsx`

All consumer files need two changes:

1. Import: `import { useTheme } from '@/lib/theme'` → `import { useTheme } from '@/lib/theme-provider'`
2. Usage: `const t = useTheme()` → `const { theme: t } = useTheme()` (or `const { theme } = useTheme()`)

- [ ] **Step 1: Update `apps/mobile/app/_layout.tsx`**

This file needs the biggest change — wrap with `ThemeProvider` and use it for StatusBar/contentStyle:

```typescript
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { setArgon2Adapter } from '@keykeykey/core';
import { nativeArgon2Adapter } from '@/lib/native-argon2-adapter';
import { VaultProvider } from '@/lib/vault-context';
import { ThemeProvider, useTheme } from '@/lib/theme-provider';

// Register native Argon2id adapter before any vault operations.
setArgon2Adapter(nativeArgon2Adapter);

function RootLayoutInner() {
  const { theme, isDark } = useTheme();

  return (
    <>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: {
            backgroundColor: theme.colors.background,
          },
          animation: 'fade',
        }}
      >
        <Stack.Screen name="index" />
        <Stack.Screen name="setup" />
        <Stack.Screen name="unlock" />
        <Stack.Screen name="recovery" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen
          name="item/add"
          options={{ presentation: 'modal', animation: 'slide_from_bottom' }}
        />
        <Stack.Screen
          name="item/[id]"
          options={{ presentation: 'card', animation: 'slide_from_right' }}
        />
        <Stack.Screen
          name="item/edit"
          options={{ presentation: 'modal', animation: 'slide_from_bottom' }}
        />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  return (
    <ThemeProvider>
      <VaultProvider>
        <RootLayoutInner />
      </VaultProvider>
    </ThemeProvider>
  );
}
```

- [ ] **Step 2: Update all 15 remaining consumer files**

For each file, apply the two-line change. Files that use `const t = useTheme()`:

**Components (5 files):**

- `apps/mobile/components/Button.tsx` — `import { useTheme } from '@/lib/theme-provider'` + `const { theme: t } = useTheme()`
- `apps/mobile/components/EmptyState.tsx` — same pattern
- `apps/mobile/components/ItemCard.tsx` — same pattern, but also imports `type Theme` from `@/lib/theme`. Keep that type import from `@/lib/theme` (it's still exported there) or change to `import type { Theme } from '@/lib/theme'` as a separate import
- `apps/mobile/components/QuickUnlockPrompt.tsx` — same pattern
- `apps/mobile/components/TextInput.tsx` — same pattern

**App screens (10 files):**

- `apps/mobile/app/index.tsx` — same pattern
- `apps/mobile/app/setup.tsx` — same pattern
- `apps/mobile/app/unlock.tsx` — same pattern
- `apps/mobile/app/recovery.tsx` — same pattern
- `apps/mobile/app/(tabs)/_layout.tsx` — same pattern
- `apps/mobile/app/(tabs)/index.tsx` — same pattern
- `apps/mobile/app/(tabs)/settings.tsx` — same pattern (also uses `t` in `SettingRow` and `SettingRowToggle`)
- `apps/mobile/app/(tabs)/generator.tsx` — same pattern
- `apps/mobile/app/item/[id].tsx` — same pattern
- `apps/mobile/app/item/add.tsx` — same pattern
- `apps/mobile/app/item/edit.tsx` — same pattern

For each file:

1. Change `import { useTheme } from '@/lib/theme'` to `import { useTheme } from '@/lib/theme-provider'`
2. Change `const t = useTheme()` to `const { theme: t } = useTheme()`

Note: `settings.tsx` has 3 call sites for `useTheme()` (main component + `SettingRow` + `SettingRowToggle`). Update all three.

- [ ] **Step 3: Run all mobile tests**

```bash
pnpm --filter @keykeykey/mobile test
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/app/ apps/mobile/components/
git commit -m "refactor(mobile): migrate all files to ThemeProvider useTheme"
```

### Task 7: Add appearance row to settings screen

**Files:**

- Modify: `apps/mobile/app/(tabs)/settings.tsx`

- [ ] **Step 1: Add the appearance cycle button to settings**

In `apps/mobile/app/(tabs)/settings.tsx`, add between the SECURITY section and SYNC section (after line 158):

```typescript
// Add to imports at top:
// Already have: import { Ionicons } from '@expo/vector-icons';
// Already have: import { useTheme } from '@/lib/theme-provider';

// Inside SettingsScreen component, after destructuring useTheme:
const { theme: t, mode, setMode } = useTheme();

const themeIcon: keyof typeof Ionicons.glyphMap =
  mode === 'dark' ? 'moon-outline' : mode === 'light' ? 'sunny-outline' : 'desktop-outline';

const cycleTheme = () => {
  const modes: Array<'system' | 'light' | 'dark'> = ['system', 'light', 'dark'];
  const idx = modes.indexOf(mode);
  setMode(modes[(idx + 1) % modes.length]!);
};
```

Add this JSX section after the SECURITY section `</View>` and before the SYNC section:

```tsx
<View style={[styles.section, { borderColor: t.colors.border }]}>
  <Text style={[styles.sectionTitle, { color: t.colors.textSecondary }]}>APPEARANCE</Text>
  <Pressable
    onPress={cycleTheme}
    style={({ pressed }) => [
      styles.row,
      { borderBottomColor: t.colors.border, opacity: pressed ? 0.7 : 1 },
    ]}
  >
    <Ionicons name={themeIcon} size={20} color={t.colors.textSecondary} style={styles.rowIcon} />
    <View style={styles.rowContent}>
      <Text style={[styles.rowLabel, { color: t.colors.text }]}>Theme</Text>
      <Text style={[styles.rowSubtitle, { color: t.colors.textSecondary }]}>
        {mode.charAt(0).toUpperCase() + mode.slice(1)}
      </Text>
    </View>
    <Ionicons name="chevron-forward" size={18} color={t.colors.textSecondary} />
  </Pressable>
</View>
```

- [ ] **Step 2: Run mobile tests**

```bash
pnpm --filter @keykeykey/mobile test
```

Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/app/\(tabs\)/settings.tsx
git commit -m "feat(mobile): add theme appearance toggle to settings screen"
```

---

## Chunk 4: Final Verification

### Task 8: Run full test suite and verify builds

- [ ] **Step 1: Build shared packages**

```bash
pnpm --filter @keykeykey/core --filter @keykeykey/ui build
```

- [ ] **Step 2: Run all tests across the monorepo**

```bash
pnpm test
```

Expected: all tests pass across core, ui, mobile, desktop, extension.

- [ ] **Step 3: Build extension and verify icons in output**

```bash
pnpm --filter @keykeykey/extension build
ls apps/extension/dist/icons/
cat apps/extension/dist/manifest.json | grep -A5 icons
```

Expected: icons directory has 3 PNG files, manifest.json has `"icons"` section intact.

- [ ] **Step 4: Run format check**

```bash
pnpm format:check
```

If it fails, run `pnpm format` and commit the formatting fixes.

- [ ] **Step 5: Commit any final fixes**

```bash
git add -A
git commit -m "chore: final formatting and verification"
```
