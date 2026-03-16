# Icon Standardization & Theme Consistency

Standardize the app icon across all platforms (mobile, desktop, extension) to a unified "three overlapping keys" design, fix theme drift in the extension CSS, and add a manual theme toggle to mobile.

## 1. Unified Icon Design

### Visual Description

Three overlapping keys arranged side by side on a near-black rounded square background:

- **Style:** Overlapping / layered. Center key is taller and rendered in front (higher z-order). Outer keys have `opacity: 0.85`.
- **Background:** Near-black `#1C1917` (stone-900) rounded square.
- **Key colors:**
  - Outer keys: fill `#A3E635` (lime), stroke `#65A30D` (lime-700)
  - Center key: fill `#84CC16` (lime-500), stroke `#4D7C0F` (lime-800)
- **Key holes:** Filled with the background color (`#1C1917`) for a cutout/transparency effect.
- **Positioning:** Keys are centered within the square, shifted slightly down and right for optical centering (the key heads are at the top, shafts extend downward, creating visual weight toward the bottom).

### Master Source

Create a new `assets/` directory at the repo root with a single SVG file `assets/icon-master.svg` (200x200 viewBox) as the source of truth. All platform-specific raster icons are generated from this SVG.

### Platform Deliverables

**Mobile (Expo):**

- `apps/mobile/assets/icon.png` — 1024x1024 PNG rendered from master SVG
- Update `apps/mobile/app.json`: change `splash.backgroundColor` and `android.adaptiveIcon.backgroundColor` from `#A3E635` to `#1C1917`

**Desktop (Tauri):**

- Regenerate all files in `apps/desktop/src-tauri/icons/` from master SVG:
  - `icon.png` (512x512), `icon.ico` (multi-size), `icon.icns` (macOS)
  - `32x32.png`, `128x128.png`, `128x128@2x.png`
  - `64x64.png` (exists on disk but not referenced in `tauri.conf.json` bundle config — regenerate for completeness)
  - All `Square*.png` variants for Windows Store
  - All `ios/` and `android/` density variants
- Update `apps/desktop/src-tauri/icons/android/values/ic_launcher_background.xml`: change `#fff` to `#1C1917`

**Extension:**

- Create `apps/extension/icons/` directory (no `public/` — the extension has no public dir; manifest.json references `icons/` relative to the extension root):
  - `icon-128.png` — full icon from master SVG
  - `icon-48.png` — full icon from master SVG
  - `icon-16.png` — simplified variant (keys only, no background square) for toolbar legibility
- Fix `apps/extension/vite.config.ts`:
  - Remove the `delete manifest.icons` line from the `copyManifest` plugin
  - Add a file copy step to copy `icons/*.png` from the extension source to `dist/icons/` so the manifest icon paths resolve in the built output

## 2. Extension CSS Token Alignment

Fix 5 CSS variable values in `apps/extension/src/popup/styles/global.css` that have drifted from the shared tokens in `packages/ui/src/tokens/index.ts`:

| Variable            | Mode  | Current   | Corrected (matches token)         |
| ------------------- | ----- | --------- | --------------------------------- |
| `--input-bg`        | light | `#f5f5f4` | `#FAFAF9` (`inputBackground`)     |
| `--input-bg`        | dark  | `#0a3622` | `#022C22` (`inputBackgroundDark`) |
| `--error`           | dark  | `#f87171` | `#EF4444` (`error`)               |
| `--success`         | dark  | `#4ade80` | `#22C55E` (`success`)             |
| `--scrollbar-thumb` | light | `#d6d3d1` | `#e7e5e4` (`border`)              |

**Note on dark-mode error/success:** The extension used lighter variants (`#f87171` red-400, `#4ade80` green-400) likely for contrast on dark backgrounds. However, the shared tokens use the same `error`/`success` values for both modes, and both mobile and desktop already use those shared values in dark mode. Aligning to the tokens ensures consistency across all platforms.

## 3. Mobile Theme Toggle

Add a manual light/dark/system theme toggle to the mobile app, matching the desktop cycle-button pattern.

### Implementation

**New: `apps/mobile/lib/theme-provider.tsx`**

A React context provider (similar to desktop's `ThemeProvider`) that:

- Stores user preference in `AsyncStorage` (key: `keykeykey-theme-mode`)
- Supports three modes: `'system'` (default), `'light'`, `'dark'`
- When mode is `'system'`, delegates to `useColorScheme()` from React Native
- When mode is `'light'` or `'dark'`, overrides the system preference
- Exposes `{ theme, mode, setMode, isDark }` via context (same shape as desktop/extension)

**Update: `apps/mobile/lib/theme.ts`**

- Keep `lightTheme`, `darkTheme`, and `Theme` type exports (unchanged)
- Remove the `useTheme()` hook (moved to provider)

**Breaking change:** The `useTheme()` return type changes from `Theme` (the theme object directly) to `ThemeContextType` (`{ theme, mode, setMode, isDark }`). All 16 consumer files must update from `const theme = useTheme()` to `const { theme } = useTheme()`:

- `app/index.tsx`, `app/setup.tsx`, `app/unlock.tsx`, `app/recovery.tsx`
- `app/(tabs)/_layout.tsx`, `app/(tabs)/index.tsx`, `app/(tabs)/settings.tsx`, `app/(tabs)/generator.tsx`
- `app/item/[id].tsx`, `app/item/add.tsx`, `app/item/edit.tsx`
- `components/Button.tsx`, `components/EmptyState.tsx`, `components/ItemCard.tsx`, `components/QuickUnlockPrompt.tsx`, `components/TextInput.tsx`

All imports change from `import { useTheme } from '../lib/theme'` to `import { useTheme } from '../lib/theme-provider'` (adjust relative path per file).

**Update: `apps/mobile/app/_layout.tsx`**

- Wrap the app with `<ThemeProvider>`
- Use `useTheme()` from the new provider instead of direct `useColorScheme()`

**Update: `apps/mobile/app/(tabs)/settings.tsx`**

- Add an "Appearance" row in the settings screen
- Cycle button with icons: Monitor (system) → Sun (light) → Moon (dark)
- Shows current mode label next to the icon
- Tapping cycles through: system → light → dark → system

### Behavior

- Default: `'system'` — follows OS dark/light preference (same as current behavior)
- User override persists across app restarts via AsyncStorage
- StatusBar style updates to match resolved theme (light-content for dark, dark-content for light)

## 4. Testing

### Icon

- Visual verification: screenshot comparison at key sizes (16, 48, 128, 512, 1024)
- Verify manifest.json references resolve to actual files in extension build

### Extension CSS

- Existing theme tests in `apps/extension` validate token usage
- Manual visual check in both light and dark mode after CSS changes

### Mobile Theme Toggle

- Unit tests for the new `ThemeProvider`:
  - Default mode is `'system'`
  - `setMode('dark')` resolves to dark theme
  - `setMode('light')` resolves to light theme
  - `setMode('system')` delegates to system preference
  - Mode persists to AsyncStorage
- UI test: settings screen shows appearance row with cycle behavior

## 5. Out of Scope

- Redesigning the splash screen (only updating background color to match new icon)
- Adding theme toggle to the extension (already exists)
- Changing the color palette itself — only aligning existing values
