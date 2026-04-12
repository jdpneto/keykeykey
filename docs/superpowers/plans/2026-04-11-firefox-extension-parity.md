# Firefox Extension Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the Firefox browser extension to feature parity with the Chrome extension (which has received dozens of commits of fixes and features) by producing a Firefox-specific build that correctly handles Google OAuth (PKCE via `launchWebAuthFlow`), clipboard auto-clear (`navigator.clipboard` direct), and Firefox-specific manifest fields (`browser_specific_settings.gecko.id`).

**Architecture:** Dual Vite build targeting `dist-chrome/` and `dist-firefox/` via an `EXT_TARGET` env var. Single base `manifest.json` deep-merged with per-target override files. Runtime branching on `getBrowserKind()` (a new consolidated helper) for Google OAuth flow, clipboard clearing, and one restore-screen shortcut. Zero Chrome runtime behavior changes. No new core package changes — the core's `createAdapterFromConfig` already handles the Firefox refresh-token path when no `googleDriveTokenProvider` override is passed.

**Tech Stack:** TypeScript 5.7, Vite 6, `webextension-polyfill`, `@noble/*` crypto (unchanged), Zustand, React 19, Vitest, `web-ext` CLI.

**Spec:** `docs/superpowers/specs/2026-04-11-firefox-extension-parity-design.md`
**Follow-up spec (not part of this plan):** `docs/superpowers/specs/2026-04-11-firefox-e2e-design.md`

---

## File Structure

| Action | File                                                 | Responsibility                                                                                          |
| ------ | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Modify | `apps/extension/manifest.json`                       | Strip to base (shared) fields only                                                                      |
| Create | `apps/extension/manifest.chrome.json`                | Chrome-only manifest overrides (`key`, `oauth2`, `offscreen`, `service_worker`)                         |
| Create | `apps/extension/manifest.firefox.json`               | Firefox-only overrides (`gecko.id`, `clipboardWrite`, `scripts` background)                             |
| Modify | `apps/extension/vite.config.ts`                      | `EXT_TARGET`-aware build — emits `dist-chrome/` or `dist-firefox/`, merges base+overrides manifest      |
| Modify | `apps/extension/package.json`                        | New scripts (`build:chrome`, `build:firefox`, `build`, `lint:manifest:firefox`); remove `@types/chrome` |
| Modify | `.gitignore` (root)                                  | Add `dist-chrome/` and `dist-firefox/`                                                                  |
| Modify | `apps/extension/.env.example`                        | Comment documenting the gecko.id-derived Firefox redirect URL                                           |
| Modify | `apps/extension/README.md`                           | Install sections: `dist/` → `dist-chrome/` / `dist-firefox/`                                            |
| Modify | `eslint.config.js` (root)                            | `no-restricted-globals: chrome` rule scoped to `apps/extension/src/**`                                  |
| Create | `apps/extension/src/lib/browser-detect.ts`           | Single `getBrowserKind()` helper (`'chrome' \| 'firefox' \| 'safari'`)                                  |
| Create | `apps/extension/src/lib/browser-detect.test.ts`      | Unit tests for `getBrowserKind`                                                                         |
| Modify | `apps/extension/src/lib/dropbox-oauth.ts`            | Use shared `getBrowserKind` instead of local `detectBrowser`                                            |
| Modify | `apps/extension/src/lib/onedrive-oauth.ts`           | Use shared `getBrowserKind` instead of local `detectBrowser`                                            |
| Modify | `apps/extension/src/lib/google-oauth.ts`             | Chrome path (existing) + new Firefox PKCE path dispatched at module load                                |
| Modify | `apps/extension/src/background/clipboard.ts`         | Firefox branch: direct `navigator.clipboard.writeText('')`                                              |
| Modify | `apps/extension/src/background/sync.ts`              | Only pass `googleDriveTokenProvider` override on Chrome                                                 |
| Modify | `apps/extension/src/background/message-handler.ts`   | Capture real tokens from `startGoogleOAuth()`; pass refresh token to `revokeGoogleToken`                |
| Modify | `apps/extension/src/popup/screens/RestoreScreen.tsx` | Chrome-only shortcut (skip-to-password for Google) guarded on `getBrowserKind()`                        |

---

## Task 1: Consolidated `browser-detect.ts` helper

**Files:**

- Create: `apps/extension/src/lib/browser-detect.ts`
- Create: `apps/extension/src/lib/browser-detect.test.ts`
- Modify: `apps/extension/src/lib/dropbox-oauth.ts`
- Modify: `apps/extension/src/lib/onedrive-oauth.ts`

### Context

Today, both `dropbox-oauth.ts` and `onedrive-oauth.ts` duplicate a `detectBrowser(): string` function that reads `navigator.userAgent`. We need a single source of truth so future code that branches on browser kind has one place to import from. The helper must also be type-safe (return a discriminated union, not `string`).

- [ ] **Step 1: Write the failing test**

Create `apps/extension/src/lib/browser-detect.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getBrowserKind } from './browser-detect.js';

describe('getBrowserKind', () => {
  const originalNavigator = globalThis.navigator;

  afterEach(() => {
    Object.defineProperty(globalThis, 'navigator', {
      value: originalNavigator,
      configurable: true,
      writable: true,
    });
  });

  function setUserAgent(ua: string): void {
    Object.defineProperty(globalThis, 'navigator', {
      value: { userAgent: ua },
      configurable: true,
      writable: true,
    });
  }

  it('returns "firefox" for Firefox user agents', () => {
    setUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:121.0) Gecko/20100101 Firefox/121.0',
    );
    expect(getBrowserKind()).toBe('firefox');
  });

  it('returns "safari" for Safari user agents without Chrome', () => {
    setUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
    );
    expect(getBrowserKind()).toBe('safari');
  });

  it('does not return "safari" for Chrome (which has both "Safari" and "Chrome" in UA)', () => {
    setUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    );
    expect(getBrowserKind()).toBe('chrome');
  });

  it('returns "chrome" for a plain Chromium user agent', () => {
    setUserAgent(
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    );
    expect(getBrowserKind()).toBe('chrome');
  });

  it('returns "chrome" when navigator is undefined (e.g., worker-like contexts)', () => {
    Object.defineProperty(globalThis, 'navigator', {
      value: undefined,
      configurable: true,
      writable: true,
    });
    expect(getBrowserKind()).toBe('chrome');
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
pnpm --filter @keykeykey/extension test -- browser-detect
```

Expected: FAIL with a module resolution error (`Failed to load ./browser-detect.js`) or "getBrowserKind is not defined" since the helper file doesn't exist yet.

- [ ] **Step 3: Implement the helper**

Create `apps/extension/src/lib/browser-detect.ts`:

```ts
/**
 * Returns the browser kind this extension is running in.
 *
 * Detection is based on `navigator.userAgent`, the same approach used by
 * `webextension-polyfill` consumers across the codebase. Returns `'chrome'`
 * as a safe default when `navigator` is unavailable (e.g., SSR, test harness,
 * or exotic worker contexts).
 *
 * Used for runtime branching on Chrome-only APIs:
 *   - `chrome.identity.getAuthToken` vs `launchWebAuthFlow` (Google OAuth)
 *   - `chrome.offscreen` vs direct `navigator.clipboard` (clipboard auto-clear)
 *   - Chrome-only restore flow shortcut (Google silent consent)
 */
export type BrowserKind = 'chrome' | 'firefox' | 'safari';

export function getBrowserKind(): BrowserKind {
  if (typeof navigator === 'undefined') return 'chrome';
  const ua = navigator.userAgent;
  if (ua.includes('Firefox')) return 'firefox';
  if (ua.includes('Safari') && !ua.includes('Chrome')) return 'safari';
  return 'chrome';
}
```

- [ ] **Step 4: Run the test and verify it passes**

Run:

```bash
pnpm --filter @keykeykey/extension test -- browser-detect
```

Expected: All 5 tests pass.

- [ ] **Step 5: Update `dropbox-oauth.ts` to use the shared helper**

Open `apps/extension/src/lib/dropbox-oauth.ts`. Replace the top-of-file imports and the local `detectBrowser` function with an import of `getBrowserKind`. Keep the rest of the file unchanged.

Change lines 1-26 (before):

```ts
import browser from 'webextension-polyfill';
import {
  generateCodeVerifier,
  generateState,
  buildDropboxAuthUrl,
  exchangeDropboxAuthCode,
  revokeDropboxToken as coreRevokeDropboxToken,
} from '@keykeykey/core/sync';

// Each browser has a different OAuth client ID due to different redirect URIs
const DROPBOX_CLIENT_IDS: Record<string, string> = {
  chrome: import.meta.env.VITE_DROPBOX_CLIENT_ID_CHROME ?? '',
  safari: import.meta.env.VITE_DROPBOX_CLIENT_ID_SAFARI ?? '',
  firefox: import.meta.env.VITE_DROPBOX_CLIENT_ID_FIREFOX ?? '',
};

function detectBrowser(): string {
  if (typeof navigator !== 'undefined') {
    const ua = navigator.userAgent;
    if (ua.includes('Firefox')) return 'firefox';
    if (ua.includes('Safari') && !ua.includes('Chrome')) return 'safari';
  }
  return 'chrome';
}

export const DROPBOX_CLIENT_ID = DROPBOX_CLIENT_IDS[detectBrowser()];
```

Replace with:

```ts
import browser from 'webextension-polyfill';
import {
  generateCodeVerifier,
  generateState,
  buildDropboxAuthUrl,
  exchangeDropboxAuthCode,
  revokeDropboxToken as coreRevokeDropboxToken,
} from '@keykeykey/core/sync';
import { getBrowserKind } from './browser-detect.js';

// Each browser has a different OAuth client ID due to different redirect URIs
const DROPBOX_CLIENT_IDS: Record<string, string> = {
  chrome: import.meta.env.VITE_DROPBOX_CLIENT_ID_CHROME ?? '',
  safari: import.meta.env.VITE_DROPBOX_CLIENT_ID_SAFARI ?? '',
  firefox: import.meta.env.VITE_DROPBOX_CLIENT_ID_FIREFOX ?? '',
};

export const DROPBOX_CLIENT_ID = DROPBOX_CLIENT_IDS[getBrowserKind()];
```

- [ ] **Step 6: Update `onedrive-oauth.ts` to use the shared helper**

Open `apps/extension/src/lib/onedrive-oauth.ts`. Apply the same change — remove the local `detectBrowser` function, import `getBrowserKind`, and use it as the lookup key.

Change lines 1-25 (before):

```ts
import browser from 'webextension-polyfill';
import {
  generateCodeVerifier,
  generateState,
  buildOneDriveAuthUrl,
  exchangeOneDriveAuthCode,
} from '@keykeykey/core/sync';

// Each browser has a different OAuth client ID due to different redirect URIs
const ONEDRIVE_CLIENT_IDS: Record<string, string> = {
  chrome: import.meta.env.VITE_ONEDRIVE_CLIENT_ID_CHROME ?? '',
  safari: import.meta.env.VITE_ONEDRIVE_CLIENT_ID_SAFARI ?? '',
  firefox: import.meta.env.VITE_ONEDRIVE_CLIENT_ID_FIREFOX ?? '',
};

function detectBrowser(): string {
  if (typeof navigator !== 'undefined') {
    const ua = navigator.userAgent;
    if (ua.includes('Firefox')) return 'firefox';
    if (ua.includes('Safari') && !ua.includes('Chrome')) return 'safari';
  }
  return 'chrome';
}

export const ONEDRIVE_CLIENT_ID = ONEDRIVE_CLIENT_IDS[detectBrowser()];
```

Replace with:

```ts
import browser from 'webextension-polyfill';
import {
  generateCodeVerifier,
  generateState,
  buildOneDriveAuthUrl,
  exchangeOneDriveAuthCode,
} from '@keykeykey/core/sync';
import { getBrowserKind } from './browser-detect.js';

// Each browser has a different OAuth client ID due to different redirect URIs
const ONEDRIVE_CLIENT_IDS: Record<string, string> = {
  chrome: import.meta.env.VITE_ONEDRIVE_CLIENT_ID_CHROME ?? '',
  safari: import.meta.env.VITE_ONEDRIVE_CLIENT_ID_SAFARI ?? '',
  firefox: import.meta.env.VITE_ONEDRIVE_CLIENT_ID_FIREFOX ?? '',
};

export const ONEDRIVE_CLIENT_ID = ONEDRIVE_CLIENT_IDS[getBrowserKind()];
```

- [ ] **Step 7: Run typecheck + the full extension test suite**

Run:

```bash
pnpm --filter @keykeykey/extension typecheck
pnpm --filter @keykeykey/extension test
```

Expected: Typecheck passes. All tests pass. The two refactored oauth files still type-check and the rest of the suite is unaffected.

- [ ] **Step 8: Commit**

```bash
git add apps/extension/src/lib/browser-detect.ts \
        apps/extension/src/lib/browser-detect.test.ts \
        apps/extension/src/lib/dropbox-oauth.ts \
        apps/extension/src/lib/onedrive-oauth.ts
git commit -m "refactor(extension): consolidate detectBrowser into shared browser-detect helper"
```

---

## Task 2: Dual-target Vite build (`dist-chrome/` + `dist-firefox/`)

**Files:**

- Modify: `apps/extension/manifest.json`
- Create: `apps/extension/manifest.chrome.json`
- Create: `apps/extension/manifest.firefox.json`
- Modify: `apps/extension/vite.config.ts`
- Modify: `apps/extension/package.json`
- Modify: `.gitignore` (root)

### Context

Today the extension emits a single `dist/manifest.json` by copying `manifest.json` via a Vite plugin. The plugin rewrites built paths for popup HTML, background JS, and content script JS. We need to split this into two targets: `dist-chrome/` and `dist-firefox/`, each with its own merged manifest.

The Chrome manifest keeps `key` (Chrome extension ID pinning), `oauth2` (powers `chrome.identity.getAuthToken`), `offscreen` permission, and `background.service_worker`. The Firefox manifest drops all of those, adds `browser_specific_settings.gecko.id = "keykeykey@keykeykey.app"`, adds `clipboardWrite` permission, and uses `background.scripts: [...]` (the Firefox-preferred event page format). Both are produced by deep-merging a shared base manifest with a per-target override JSON.

The gecko.id value is load-bearing: its SHA-1 hash must match `3c49e7b76ea3e960825fdf27877252c3f6775139`, which is the hash encoded in the OAuth redirect URL already registered with Google, Dropbox, and OneDrive. Do not change it.

- [ ] **Step 1: Strip `manifest.json` to shared-only fields**

Current `manifest.json` contents are Chrome-specific. Replace the whole file with the shared base:

```json
{
  "manifest_version": 3,
  "name": "KeyKeyKey",
  "version": "0.0.1",
  "description": "Your credentials, your cloud, your keys.",
  "host_permissions": ["<all_urls>"],
  "action": {
    "default_popup": "src/popup/index.html",
    "default_title": "KeyKeyKey"
  },
  "icons": {
    "16": "icons/icon-16.png",
    "48": "icons/icon-48.png",
    "128": "icons/icon-128.png"
  },
  "content_scripts": [
    {
      "matches": ["https://*/*", "http://localhost/*"],
      "js": ["src/content/index.ts"],
      "run_at": "document_idle"
    }
  ]
}
```

- [ ] **Step 2: Create `manifest.chrome.json`**

Create `apps/extension/manifest.chrome.json`:

```json
{
  "key": "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAi6CVT65k8TxXFp9T0NcItujuN2eVtDjzANzFjIdZJX+7ysWE0SpnoUQteCGiJxTsqBLqx98JKiS3IG1IaqsE70w1Kh3q7sYNoI/lGM65cohC6/ViGE43fEX87ZQEc1Kr8N8rznaPj07Yf4whpLS54IWvdnLqTc4AA9Le3XfydaZdoATxNTYvHpfnfWBlh5hEzr0yKQmhgtR7YhKd9EMREvcKZhV3D5RF5wh1UrZKOxs+ObLX+z78FOhg+EGZR0rtCcrmaruItXbNBGWFfdTtBVbPAgbus5Nbtju9YO4lQJKTj+9//u0HxDJ5OL121l+YNMVVnsRnu6IugI2nEb6kHQIDAQAB",
  "oauth2": {
    "client_id": "960196785492-54nhfo9h2f8ef90j4srjdsa7tvsl4jdq.apps.googleusercontent.com",
    "scopes": ["https://www.googleapis.com/auth/drive.appdata"]
  },
  "permissions": ["storage", "activeTab", "alarms", "windows", "offscreen", "tabs", "identity"],
  "background": {
    "service_worker": "src/background/index.ts",
    "type": "module"
  }
}
```

Note: the `background.service_worker` path is the source path. The Vite plugin rewrites it to `background/index.js` (the built path) at build time, same as today.

- [ ] **Step 3: Create `manifest.firefox.json`**

Create `apps/extension/manifest.firefox.json`:

```json
{
  "browser_specific_settings": {
    "gecko": {
      "id": "keykeykey@keykeykey.app",
      "strict_min_version": "121.0"
    }
  },
  "permissions": [
    "storage",
    "activeTab",
    "alarms",
    "windows",
    "tabs",
    "identity",
    "clipboardWrite"
  ],
  "background": {
    "scripts": ["src/background/index.ts"],
    "type": "module"
  }
}
```

- [ ] **Step 4: Rewrite `vite.config.ts` to be `EXT_TARGET`-aware**

Replace the entire contents of `apps/extension/vite.config.ts` with:

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, readdirSync } from 'fs';
import { resolve } from 'path';

type Target = 'chrome' | 'firefox';
const TARGET: Target = (process.env.EXT_TARGET as Target) || 'chrome';

if (TARGET !== 'chrome' && TARGET !== 'firefox') {
  throw new Error(`Invalid EXT_TARGET="${TARGET}" — must be "chrome" or "firefox"`);
}

const OUT_DIR = `dist-${TARGET}`;

/**
 * Recursively merge `overrides` into `base`. Arrays in `overrides` replace the
 * corresponding array in `base` (no element-wise merging). Plain objects are
 * deeply merged. Scalars are replaced.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function deepMerge(base: any, overrides: any): any {
  if (Array.isArray(overrides)) return overrides;
  if (overrides === null || typeof overrides !== 'object') return overrides;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const out: Record<string, any> = { ...(base ?? {}) };
  for (const [key, value] of Object.entries(overrides)) {
    out[key] = key in out ? deepMerge(out[key], value) : value;
  }
  return out;
}

// Copy base + per-target manifest overrides, rewrite built paths, copy icons
const copyManifest = (): import('vite').Plugin => ({
  name: 'copy-manifest',
  closeBundle() {
    const basePath = resolve(__dirname, 'manifest.json');
    const overridesPath = resolve(__dirname, `manifest.${TARGET}.json`);
    const base = JSON.parse(readFileSync(basePath, 'utf-8'));
    const overrides = JSON.parse(readFileSync(overridesPath, 'utf-8'));
    const manifest = deepMerge(base, overrides);

    // Rewrite paths for built output (mirrors what the old plugin did)
    manifest.action.default_popup = 'src/popup/index.html';
    if (manifest.background?.service_worker) {
      manifest.background.service_worker = 'background/index.js';
    }
    if (manifest.background?.scripts) {
      manifest.background.scripts = ['background/index.js'];
    }
    manifest.content_scripts[0].js = ['content/index.js'];

    // Copy icons into the target dist
    const iconsDir = resolve(__dirname, 'icons');
    const distIconsDir = resolve(__dirname, `${OUT_DIR}/icons`);
    mkdirSync(distIconsDir, { recursive: true });
    for (const file of readdirSync(iconsDir)) {
      if (file.endsWith('.png')) {
        copyFileSync(resolve(iconsDir, file), resolve(distIconsDir, file));
      }
    }

    const dest = resolve(__dirname, `${OUT_DIR}/manifest.json`);
    writeFileSync(dest, JSON.stringify(manifest, null, 2));
  },
});

// Content script must be built as IIFE (not ES module) because MV3 content
// scripts don't support `import` statements. We build it separately via a
// plugin that runs a second Vite build after the main build completes.
const buildContentScript = (): import('vite').Plugin => ({
  name: 'build-content-script',
  async closeBundle() {
    const { build } = await import('vite');
    await build({
      configFile: false,
      build: {
        outDir: `${OUT_DIR}/content`,
        sourcemap: true,
        emptyOutDir: false,
        lib: {
          entry: resolve(__dirname, 'src/content/index.ts'),
          formats: ['iife'],
          name: 'KeyKeyKeyContent',
          fileName: () => 'index.js',
        },
        rollupOptions: {
          output: {
            // Inline all dependencies — content scripts can't load separate chunks
            inlineDynamicImports: true,
          },
        },
      },
    });
  },
});

export default defineConfig({
  plugins: [react(), copyManifest(), buildContentScript()],
  build: {
    outDir: OUT_DIR,
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

Notes:

- `OUT_DIR` is derived from `TARGET` and used consistently in `build.outDir`, the content script sub-build, the icons copy, and the final manifest write.
- The `offscreen` entry point stays in the rollup input for both targets. Firefox will build and emit it harmlessly, but the Firefox manifest never references `offscreen/*` so it's dead weight — acceptable for now (cheap, simplifies config). A future optimization can prune it on Firefox.

- [ ] **Step 5: Update `apps/extension/package.json` scripts**

Open `apps/extension/package.json`. Replace the `scripts` block with:

```json
  "scripts": {
    "dev": "EXT_TARGET=chrome vite",
    "build": "pnpm build:chrome && pnpm build:firefox",
    "build:chrome": "EXT_TARGET=chrome vite build",
    "build:firefox": "EXT_TARGET=firefox vite build",
    "typecheck": "tsc --noEmit",
    "test": "vitest run --passWithNoTests",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage --passWithNoTests",
    "lint": "eslint src/",
    "lint:manifest": "web-ext lint --source-dir dist-chrome",
    "lint:manifest:firefox": "web-ext lint --source-dir dist-firefox",
    "clean": "rm -rf dist dist-chrome dist-firefox"
  },
```

Changes:

- `dev` pins `EXT_TARGET=chrome` so the dev server works without fiddling with env vars.
- `build` now runs both targets sequentially.
- `build:chrome` / `build:firefox` are new single-target builds.
- `lint:manifest` (existing, Chrome-only) points at `dist-chrome`.
- `lint:manifest:firefox` is new.
- `clean` removes both new dirs and the legacy `dist` dir.

- [ ] **Step 6: Add `dist-chrome/` and `dist-firefox/` to root `.gitignore`**

Open the root `/Users/davidneto/keykeykey/.gitignore`. Find the `# Build outputs` block (around line 11):

```
# Build outputs
dist/
build/
out/
.next/
*.tsbuildinfo
```

Replace with:

```
# Build outputs
dist/
dist-chrome/
dist-firefox/
build/
out/
.next/
*.tsbuildinfo
```

- [ ] **Step 7: Build both targets cleanly**

Run:

```bash
pnpm --filter @keykeykey/extension clean
pnpm --filter @keykeykey/core --filter @keykeykey/ui build
pnpm --filter @keykeykey/extension build
```

Expected:

- Build succeeds for both targets with no errors.
- Directory listing after the build:

```bash
ls apps/extension/dist-chrome/
ls apps/extension/dist-firefox/
```

Both should contain: `manifest.json`, `icons/`, `background/index.js`, `content/index.js`, `src/popup/index.html`, etc.

- [ ] **Step 8: Inspect the merged manifests**

Run:

```bash
cat apps/extension/dist-chrome/manifest.json | head -40
cat apps/extension/dist-firefox/manifest.json | head -40
```

Verify:

- `dist-chrome/manifest.json` contains `"key": "MIIBIjAN…"`, `"oauth2": { … }`, `"offscreen"` in `permissions`, `"background": { "service_worker": "background/index.js", "type": "module" }`.
- `dist-firefox/manifest.json` contains `"browser_specific_settings": { "gecko": { "id": "keykeykey@keykeykey.app", "strict_min_version": "121.0" } }`, `"clipboardWrite"` in `permissions`, `"background": { "scripts": ["background/index.js"], "type": "module" }`, and does NOT contain `key`, `oauth2`, or `offscreen`.

- [ ] **Step 9: Run web-ext lint on the Firefox build**

Run:

```bash
pnpm --filter @keykeykey/extension lint:manifest:firefox
```

Expected: `0 errors, 0 notices` (warnings about `host_permissions` or extension ID format are acceptable — if any errors appear, read them and fix them before proceeding).

Common issues and fixes:

- Error about `offscreen` permission: means the override didn't apply. Re-check `manifest.firefox.json`.
- Error about missing `browser_specific_settings.gecko.id`: means `deepMerge` dropped it. Re-check the plugin.
- Error about `key`: Firefox rejects it. Re-check the override and that the base manifest doesn't contain `key` anymore.

- [ ] **Step 10: Run the full test suite**

Run:

```bash
pnpm --filter @keykeykey/extension typecheck
pnpm --filter @keykeykey/extension test
```

Expected: typecheck passes, all tests pass. No test references the manifest files or build output, so the scope here is just "didn't accidentally break the TypeScript build."

- [ ] **Step 11: Commit**

```bash
git add apps/extension/manifest.json \
        apps/extension/manifest.chrome.json \
        apps/extension/manifest.firefox.json \
        apps/extension/vite.config.ts \
        apps/extension/package.json \
        .gitignore
git commit -m "build(extension): dual-target Chrome + Firefox build"
```

---

## Task 3: Remove `@types/chrome` + add ESLint guardrail

**Files:**

- Modify: `apps/extension/package.json`
- Modify: `eslint.config.js` (root)

### Context

`@types/chrome` lets code that references `chrome.foo` type-check. The extension uses `webextension-polyfill`, so any `chrome.*` reference is an accidental Chrome-ism. We want it to become a type error instead. Combined with an ESLint rule disallowing the `chrome` global, this makes regressions impossible.

Zero existing runtime code in `src/` references `chrome.*` directly — only three comments mention it (safe, not caught by lint or typecheck). The `google-oauth.ts` rewrite in Task 4 uses `browser.identity` with a cast, not `chrome.identity`, so nothing needs an exemption.

- [ ] **Step 1: Remove `@types/chrome` from `package.json`**

Open `apps/extension/package.json`. Remove the `"@types/chrome": "^0.0.304"` line from `devDependencies`. The surrounding block should look like:

```json
  "devDependencies": {
    "@crxjs/vite-plugin": "^2.0.0-beta.30",
    "@testing-library/jest-dom": "^6.6.0",
    "@testing-library/react": "^16.0.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@types/webextension-polyfill": "^0.12.5",
    ...
  }
```

(Delete only the `@types/chrome` line — leave everything else alone.)

- [ ] **Step 2: Reinstall dependencies**

Run from the monorepo root:

```bash
pnpm install
```

Expected: pnpm updates the lockfile and removes the `@types/chrome` entry from `node_modules`.

- [ ] **Step 3: Run typecheck to verify no regression**

Run:

```bash
pnpm --filter @keykeykey/extension typecheck
```

Expected: passes. If a `chrome.foo` reference surfaces anywhere, fix it (replace with `browser.foo` or a `(browser as any)` cast that matches the existing pattern in `google-oauth.ts`) before proceeding.

- [ ] **Step 4: Add the ESLint guardrail**

Open the root `/Users/davidneto/keykeykey/eslint.config.js`. Replace its contents with:

```js
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: [
      '**/dist/**',
      '**/dist-chrome/**',
      '**/dist-firefox/**',
      '**/build/**',
      '**/coverage/**',
      '**/node_modules/**',
      'apps/desktop/src-tauri/**',
    ],
  },
  {
    files: ['apps/extension/src/**/*.ts', 'apps/extension/src/**/*.tsx'],
    rules: {
      'no-restricted-globals': [
        'error',
        {
          name: 'chrome',
          message:
            'Use the `browser` namespace from webextension-polyfill instead. chrome.* references break Firefox.',
        },
      ],
    },
  },
);
```

- [ ] **Step 5: Run lint to verify the rule applies cleanly**

Run:

```bash
pnpm --filter @keykeykey/extension lint
```

Expected: passes. No existing code in `apps/extension/src/**` references the `chrome` global as a runtime expression (verified via grep: only comments mention `chrome`, which the rule does not flag).

If the rule does fire, you'll see a message like:

```
error  Unexpected use of 'chrome'  no-restricted-globals
```

Fix the offender by replacing `chrome.foo` with `browser.foo`, or — if it must reach a Chrome-only API — use the existing pattern from `google-oauth.ts`:

```ts
const identity = browser.identity as unknown as {
  getAuthToken: (opts: { interactive: boolean }) => Promise<unknown>;
};
```

- [ ] **Step 6: Run the root lint to catch any monorepo ripple**

Run from the monorepo root:

```bash
pnpm lint
```

Expected: all packages lint cleanly. If an ignore-path regression surfaces (e.g., `dist-chrome/` files being linted), fix the `ignores` block in `eslint.config.js`.

- [ ] **Step 7: Commit**

```bash
git add apps/extension/package.json pnpm-lock.yaml eslint.config.js
git commit -m "chore(extension): drop @types/chrome + enforce browser.* via ESLint"
```

---

## Task 4: Google OAuth Firefox path (PKCE via `launchWebAuthFlow`)

**Files:**

- Modify: `apps/extension/src/lib/google-oauth.ts`
- Modify: `apps/extension/src/background/sync.ts`
- Modify: `apps/extension/src/background/message-handler.ts`
- Modify: `apps/extension/src/popup/screens/RestoreScreen.tsx`

### Context

Today `google-oauth.ts` uses `chrome.identity.getAuthToken`, which Firefox doesn't implement. Dropbox and OneDrive already use the correct cross-browser pattern — `launchWebAuthFlow` + PKCE via `buildAuthUrl` / `exchangeAuthCode` from the core. Google needs the same treatment for Firefox, while leaving Chrome's current `getAuthToken` path intact (so Chrome users aren't forced through a new consent screen and the existing `chrome-identity` SyncConfig placeholder keeps working).

Critical insight from the spec: the core's `createAdapterFromConfig` in `packages/core/src/sync/sync-config.ts:104-115` already handles the "use refresh token from SyncConfig" path when no `googleDriveTokenProvider` override is passed. That means Firefox needs **no runtime token provider in the extension at all** — just pass `undefined` for `adapterOverrides` and the core will call `createCachedTokenProvider(config.googleDrive.refreshToken, config.googleDrive.clientId)` automatically.

This simplifies the branching: Chrome still passes the override at `sync.ts:71`, Firefox doesn't. The only real new code is the Firefox-path `startGoogleOAuth` function in `google-oauth.ts` (mirroring the Dropbox/OneDrive flows). Every call site reads `config.googleDrive` — that field already exists and already holds `{ refreshToken, clientId }`.

- [ ] **Step 1: Rewrite `apps/extension/src/lib/google-oauth.ts`**

Replace the entire file with:

```ts
import browser from 'webextension-polyfill';
import {
  generateCodeVerifier,
  generateState,
  buildAuthUrl as buildGoogleAuthUrl,
  exchangeAuthCode as exchangeGoogleAuthCode,
  revokeToken as coreRevokeToken,
} from '@keykeykey/core/sync';
import { getBrowserKind } from './browser-detect.js';

const GOOGLE_CLIENT_ID_FIREFOX = import.meta.env.VITE_GOOGLE_CLIENT_ID_FIREFOX ?? '';

/** Result of a successful `startGoogleOAuth()` call. */
export interface GoogleOAuthResult {
  refreshToken: string;
  clientId: string;
}

// ---------------------------------------------------------------------------
// Chrome-only helpers
// ---------------------------------------------------------------------------

// `chrome.identity.getAuthToken` is not exposed through webextension-polyfill
// types. We reach it via `browser.identity` (which exists in the polyfill)
// with a cast. This is the same pattern the rest of the extension uses.
const identity = browser.identity as unknown as {
  getAuthToken: (opts: { interactive: boolean }) => Promise<unknown>;
  removeCachedAuthToken: (opts: { token: string }) => Promise<void>;
};

/**
 * Extract a token string from the `getAuthToken` result.
 *
 * webextension-polyfill returns the token string directly; some Chrome builds
 * return `{ token: string }`. Handle both shapes.
 */
function extractToken(result: unknown): string | null {
  if (typeof result === 'string') return result;
  if (result && typeof result === 'object' && 'token' in result) {
    return (result as { token: string }).token;
  }
  return null;
}

/**
 * Chrome-only: fetch a fresh Google Drive access token via
 * `chrome.identity.getAuthToken`. Used as the `googleDriveTokenProvider`
 * adapter override on Chrome. Never called on Firefox — Firefox flows through
 * the core's `createCachedTokenProvider` path using the stored refresh token.
 *
 * Clears any cached token first to force Chrome to validate or refresh.
 * Without this, Chrome sometimes hands back a stale expired token.
 */
export async function getChromeGoogleAccessToken(): Promise<string> {
  try {
    const cached = await identity.getAuthToken({ interactive: false });
    const cachedToken = extractToken(cached);
    if (cachedToken) {
      await identity.removeCachedAuthToken({ token: cachedToken });
    }
  } catch {
    // No cached token — that's fine
  }

  const result = await identity.getAuthToken({ interactive: false });
  const token = extractToken(result);
  if (!token) {
    throw new Error('Failed to get Google access token — user may need to re-authenticate');
  }
  return token;
}

// ---------------------------------------------------------------------------
// startGoogleOAuth — dispatched at module load
// ---------------------------------------------------------------------------

async function startGoogleOAuthChrome(): Promise<GoogleOAuthResult> {
  const result = await identity.getAuthToken({ interactive: true });
  const token = extractToken(result);
  if (!token) {
    throw new Error('Google sign-in failed — no token received');
  }
  // Chrome uses placeholder values — the adapter override calls
  // getChromeGoogleAccessToken directly, so the stored refreshToken/clientId
  // in SyncConfig are never read on Chrome.
  return { refreshToken: 'chrome-identity', clientId: 'chrome-identity' };
}

async function startGoogleOAuthFirefox(): Promise<GoogleOAuthResult> {
  const codeVerifier = generateCodeVerifier();
  const state = generateState();
  const redirectUri = browser.identity.getRedirectURL();

  const authUrl = await buildGoogleAuthUrl({
    clientId: GOOGLE_CLIENT_ID_FIREFOX,
    redirectUri,
    codeVerifier,
    state,
  });

  const callbackUrl = await browser.identity.launchWebAuthFlow({
    url: authUrl,
    interactive: true,
  });
  if (!callbackUrl) {
    throw new Error('No response URL from OAuth flow');
  }

  // Verify state parameter to prevent CSRF attacks
  const url = new URL(callbackUrl);
  if (url.searchParams.get('state') !== state) {
    throw new Error('OAuth state mismatch — possible CSRF attack');
  }

  const code = url.searchParams.get('code');
  if (!code) {
    throw new Error('No authorization code in OAuth redirect');
  }

  // Exchange for tokens. No clientSecret — the Firefox extension is registered
  // as a public PKCE client.
  const tokens = await exchangeGoogleAuthCode({
    code,
    clientId: GOOGLE_CLIENT_ID_FIREFOX,
    redirectUri,
    codeVerifier,
  });

  return {
    refreshToken: tokens.refreshToken,
    clientId: GOOGLE_CLIENT_ID_FIREFOX,
  };
}

// ---------------------------------------------------------------------------
// revokeGoogleToken — dispatched per call
// ---------------------------------------------------------------------------

async function revokeGoogleTokenChrome(): Promise<void> {
  try {
    const result = await identity.getAuthToken({ interactive: false });
    const token = extractToken(result);
    if (token) {
      await identity.removeCachedAuthToken({ token });
      await fetch(`https://accounts.google.com/o/oauth2/revoke?token=${token}`);
    }
  } catch {
    // Best-effort revocation
  }
}

async function revokeGoogleTokenFirefox(refreshToken?: string): Promise<void> {
  if (!refreshToken || refreshToken === 'chrome-identity') return;
  try {
    await coreRevokeToken(refreshToken);
  } catch {
    // Best-effort revocation
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

const isFirefox = getBrowserKind() === 'firefox';

/**
 * Start the Google Drive OAuth flow.
 *
 * - On Chrome: interactive `chrome.identity.getAuthToken` (native consent).
 *   Returns `{ refreshToken: 'chrome-identity', clientId: 'chrome-identity' }`
 *   placeholders — Chrome calls `getAuthToken` at sync time and never reads
 *   these fields from SyncConfig.
 *
 * - On Firefox: PKCE flow via `browser.identity.launchWebAuthFlow`. Returns
 *   the real `{ refreshToken, clientId }` which the message handler persists
 *   into `SyncConfig.googleDrive`. The core's `createAdapterFromConfig`
 *   automatically uses them via `createCachedTokenProvider` on subsequent
 *   sync calls — no adapter override needed on Firefox.
 */
export const startGoogleOAuth = isFirefox ? startGoogleOAuthFirefox : startGoogleOAuthChrome;

/**
 * Revoke the active Google OAuth token.
 *
 * - On Chrome: ignores the argument; calls `removeCachedAuthToken` on the
 *   currently-cached token and fetches the revoke endpoint.
 *
 * - On Firefox: requires the `refreshToken` argument (the one stored in
 *   `SyncConfig.googleDrive.refreshToken`). Calls the core `revokeToken`.
 *
 * Always best-effort — never throws.
 */
export async function revokeGoogleToken(refreshToken?: string): Promise<void> {
  if (isFirefox) {
    return revokeGoogleTokenFirefox(refreshToken);
  }
  return revokeGoogleTokenChrome();
}
```

Note the public-API surface is now:

- `getChromeGoogleAccessToken` — exported, unchanged signature (used by `sync.ts` on Chrome only)
- `startGoogleOAuth` — exported, unchanged return shape `Promise<GoogleOAuthResult>`
- `revokeGoogleToken` — exported, **signature changed** from `() => Promise<void>` to `(refreshToken?: string) => Promise<void>`. Callers must pass the stored refresh token; Chrome ignores it.

- [ ] **Step 2: Update `apps/extension/src/background/sync.ts` to conditionally pass the override**

Open `apps/extension/src/background/sync.ts`. Add the `getBrowserKind` import and make the `adapterOverrides` field conditional.

Change the imports at the top of the file (after line 9):

```ts
import { getChromeGoogleAccessToken } from '../lib/google-oauth.js';
```

Add immediately below it:

```ts
import { getBrowserKind } from '../lib/browser-detect.js';
```

Find the `initLifecycle` function body (lines 50-75) and change the `adapterOverrides` line. Before:

```ts
    adapterOverrides: {
      googleDriveTokenProvider: getChromeGoogleAccessToken,
    },
```

After:

```ts
    // Chrome uses chrome.identity.getAuthToken at call time (override).
    // Firefox has no override — the core's createAdapterFromConfig falls
    // through to createCachedTokenProvider(refreshToken, clientId) using
    // the values stored in SyncConfig.googleDrive, which the Firefox
    // OAuth flow captures in startGoogleOAuthFirefox().
    adapterOverrides:
      getBrowserKind() === 'chrome'
        ? { googleDriveTokenProvider: getChromeGoogleAccessToken }
        : undefined,
```

- [ ] **Step 3: Update `message-handler.ts` — `GOOGLE_OAUTH_CONNECT` handler**

Open `apps/extension/src/background/message-handler.ts`. Find the `GOOGLE_OAUTH_CONNECT` case (around line 1051). Change the hardcoded placeholder to capture the real tokens from `startGoogleOAuth()`.

Find this block (lines ~1052-1061):

```ts
        try {
          // Interactive getAuthToken — Chrome prompts for consent
          await startGoogleOAuth();
          const config: SyncConfig = {
            provider: 'google-drive',
            masterPassword: message.masterPassword,
            // Chrome manages tokens via getAuthToken — store minimal config.
            // refreshToken is unused but required by the schema.
            googleDrive: { refreshToken: 'chrome-identity', clientId: 'chrome-identity' },
          };
```

Replace with:

```ts
        try {
          // Chrome: interactive getAuthToken, returns 'chrome-identity' placeholders.
          // Firefox: PKCE via launchWebAuthFlow, returns real refreshToken + clientId.
          const { refreshToken, clientId } = await startGoogleOAuth();
          const config: SyncConfig = {
            provider: 'google-drive',
            masterPassword: message.masterPassword,
            googleDrive: { refreshToken, clientId },
          };
```

Leave the rest of the handler (lifecycle init, saveConfig, triggerSync, etc.) unchanged.

- [ ] **Step 4: Update `message-handler.ts` — `GOOGLE_OAUTH_GET_TOKEN` handler**

Still in `message-handler.ts`. Find the `GOOGLE_OAUTH_GET_TOKEN` case (around line 1104). Currently it returns a hardcoded placeholder. Replace with the real token capture.

Find this block (lines ~1110-1128):

```ts
try {
  // Interactive getAuthToken — Chrome prompts for consent
  await startGoogleOAuth();
  // Remember which provider the user successfully signed into so the
  // SetupScreen can show the correct "Restore from …" shortcut if the
  // popup closes before the restore completes.
  await browser.storage.local.set({
    last_connected_provider: {
      provider: 'google-drive',
      timestamp: new Date().toISOString(),
    },
  });
  // Return placeholder values — adapter uses chrome.identity.getAuthToken directly.
  // Non-empty so the popup's truthy check passes.
  return { refreshToken: 'chrome-identity', clientId: 'chrome-identity' };
} catch (err) {
  return { error: err instanceof Error ? err.message : 'Google sign-in failed' };
}
```

Replace with:

```ts
try {
  // Chrome: interactive getAuthToken, returns 'chrome-identity' placeholders
  //   (adapter uses getAuthToken directly at sync time).
  // Firefox: PKCE via launchWebAuthFlow, returns real refreshToken + clientId
  //   (core's createCachedTokenProvider uses them at sync time).
  const { refreshToken, clientId } = await startGoogleOAuth();
  // Remember which provider the user successfully signed into so the
  // SetupScreen can show the correct "Restore from …" shortcut if the
  // popup closes before the restore completes.
  await browser.storage.local.set({
    last_connected_provider: {
      provider: 'google-drive',
      timestamp: new Date().toISOString(),
    },
  });
  return { refreshToken, clientId };
} catch (err) {
  return { error: err instanceof Error ? err.message : 'Google sign-in failed' };
}
```

- [ ] **Step 5: Update `message-handler.ts` — `GOOGLE_OAUTH_DISCONNECT` handler**

Still in `message-handler.ts`. Find the `GOOGLE_OAUTH_DISCONNECT` case (around line 1130). It currently calls `revokeGoogleToken()` with no args. Pass the stored refresh token through.

`getCurrentConfig` is already imported at the top of `message-handler.ts` (line 48) — no import change needed. Find the `GOOGLE_OAUTH_DISCONNECT` case. The current body is approximately:

```ts
      case 'GOOGLE_OAUTH_DISCONNECT': {
        if (sender?.tab) return { error: 'Not allowed from content scripts' };
        try {
          await revokeGoogleToken();
          const lc = getLifecycle();
          if (lc) {
            // saveConfig({ provider: 'none' }) tears down the engine but keeps
            // the lifecycle instance alive so the user can connect to a
            // different provider without re-unlocking the vault.
            await lc.saveConfig({ provider: 'none' });
          }
          setLastSynced(null);
          setSyncError(null);
          await clearSyncConfig();
          return { ok: true };
        } catch (err) {
          return { error: err instanceof Error ? err.message : 'Disconnect failed' };
        }
      }
```

Change only the `await revokeGoogleToken();` line. Replace with:

```ts
// Firefox needs the stored refresh token to revoke; Chrome ignores the arg.
const currentConfig = getCurrentConfig();
await revokeGoogleToken(currentConfig?.googleDrive?.refreshToken);
```

- [ ] **Step 6: Update `RestoreScreen.tsx` — Chrome-only shortcut guard**

Open `apps/extension/src/popup/screens/RestoreScreen.tsx`. The file currently assumes Google can skip the provider step and go straight to the password step because `chrome.identity.getAuthToken` silently reuses cached tokens. On Firefox there is no cached token — users must sign in via `launchWebAuthFlow` first, so they need to start on the provider step.

Add the import at the top of the file (after the existing imports, around line 5):

```ts
import { getBrowserKind } from '../../lib/browser-detect.js';
```

Then find lines 19-28 (the comment and `useState<Step>` call):

```tsx
// Skip provider step if initialProvider is set (e.g., Google Drive shortcut)
// Google can skip straight to the password step because chrome.identity
// silently reuses the cached token. Dropbox and OneDrive need an explicit
// OAuth sign-in each session — starting on the provider step shows the
// "Sign in with …" button so the user gets a real refresh token before
// attempting the restore. (Otherwise the restore would fail with
// "invalid_client" because the token/clientId fields are empty.)
const [step, setStep] = useState<Step>(
  initialProvider === 'google-drive' ? 'password' : 'provider',
);
```

Replace with:

```tsx
// Skip provider step if initialProvider is set (e.g., Google Drive shortcut).
//
// On Chrome, Google-Drive can skip straight to the password step because
// chrome.identity silently reuses the cached token. On Firefox, Google uses
// launchWebAuthFlow like Dropbox/OneDrive — users must click the "Sign in
// with Google" button on the provider step to get a real refresh token
// before attempting the restore. Starting on 'password' on Firefox would
// leave googleRefreshToken='chrome-identity' and the restore would fail
// with "invalid_client".
const canSkipProviderForGoogle =
  initialProvider === 'google-drive' && getBrowserKind() === 'chrome';
const [step, setStep] = useState<Step>(canSkipProviderForGoogle ? 'password' : 'provider');
```

Next, find lines 33-38 (the `useState` initializers for Google fields):

```tsx
const [googleRefreshToken, setGoogleRefreshToken] = useState(
  initialProvider === 'google-drive' ? 'chrome-identity' : '',
);
const [googleClientId, setGoogleClientId] = useState(
  initialProvider === 'google-drive' ? 'chrome-identity' : '',
);
```

Replace with:

```tsx
// On Chrome, seed with the 'chrome-identity' placeholder so the popup's
// truthy check passes without a sign-in round-trip. On Firefox, leave
// empty — the user must click "Sign in with Google" to get a real token.
const [googleRefreshToken, setGoogleRefreshToken] = useState(
  canSkipProviderForGoogle ? 'chrome-identity' : '',
);
const [googleClientId, setGoogleClientId] = useState(
  canSkipProviderForGoogle ? 'chrome-identity' : '',
);
```

- [ ] **Step 7: Run typecheck**

Run:

```bash
pnpm --filter @keykeykey/extension typecheck
```

Expected: passes. If TypeScript complains about the `revokeGoogleToken` signature change, check that all call sites pass the refresh token (or pass `undefined` explicitly, which is a valid value).

- [ ] **Step 8: Run lint**

Run:

```bash
pnpm --filter @keykeykey/extension lint
```

Expected: passes. The ESLint rule from Task 3 is scoped to flag `chrome.*` references — the rewritten `google-oauth.ts` only uses `browser.*` (with casts), so it stays clean.

- [ ] **Step 9: Run the test suite**

Run:

```bash
pnpm --filter @keykeykey/extension test
```

Expected: all existing tests pass. No test mocks `startGoogleOAuth`, `getChromeGoogleAccessToken`, or `revokeGoogleToken` (verified via grep on `apps/extension/src/**/*.test.ts`), so nothing should break.

- [ ] **Step 10: Rebuild both targets and re-run `web-ext lint` on Firefox**

Run:

```bash
pnpm --filter @keykeykey/extension build
pnpm --filter @keykeykey/extension lint:manifest:firefox
```

Expected: both builds succeed, Firefox manifest lint passes.

- [ ] **Step 11: Commit**

```bash
git add apps/extension/src/lib/google-oauth.ts \
        apps/extension/src/background/sync.ts \
        apps/extension/src/background/message-handler.ts \
        apps/extension/src/popup/screens/RestoreScreen.tsx
git commit -m "feat(extension): add Firefox Google OAuth via PKCE launchWebAuthFlow"
```

---

## Task 5: Clipboard auto-clear Firefox path

**Files:**

- Modify: `apps/extension/src/background/clipboard.ts`

### Context

The clipboard auto-clear alarm fires 30 seconds after a copy. On Chrome, the handler creates a short-lived `offscreen` document that calls `navigator.clipboard.writeText('')`. On Firefox, `chrome.offscreen` doesn't exist — today the `?.` silently short-circuits and Firefox users' clipboard never clears. Firefox 121+ allows `navigator.clipboard.writeText` from a background event page context directly, provided the manifest has `clipboardWrite` (added in Task 2).

- [ ] **Step 1: Add the Firefox branch to `clipboard.ts`**

Open `apps/extension/src/background/clipboard.ts`. Replace the entire file with:

```ts
import browser from 'webextension-polyfill';
import { getBrowserKind } from '../lib/browser-detect.js';

const CLIPBOARD_ALARM = 'clipboard-clear';

/**
 * Set up the clipboard-clear alarm listener.
 *
 * When the alarm fires:
 *   - Chrome: create a short-lived offscreen document that clears the
 *     clipboard (MV3 service workers have no DOM).
 *   - Firefox: call navigator.clipboard.writeText directly from the
 *     background event page (Firefox 121+ with clipboardWrite permission).
 *
 * Both paths are best-effort security hardening — `try`/`catch` swallows
 * failures (e.g., offscreen document already exists, Clipboard API rejected
 * for lack of focus).
 */
export function setupClipboardClear(): void {
  browser.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name !== CLIPBOARD_ALARM) return;

    if (getBrowserKind() === 'firefox') {
      try {
        await navigator.clipboard.writeText('');
      } catch {
        // Clipboard API may reject if no document is focused — acceptable
      }
      return;
    }

    // Chrome path — offscreen document
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (browser as any).offscreen?.createDocument({
        url: 'offscreen/clipboard-clear.html',
        reasons: ['CLIPBOARD'],
        justification: 'Clear clipboard after copy timeout',
      });
    } catch {
      // Offscreen document may already exist
    }
  });
}

/**
 * Schedule clipboard clearing in 30 seconds.
 */
export function scheduleClipboardClear(): void {
  browser.alarms.clear(CLIPBOARD_ALARM);
  browser.alarms.create(CLIPBOARD_ALARM, { delayInMinutes: 0.5 });
}
```

- [ ] **Step 2: Run typecheck, lint, and tests**

Run:

```bash
pnpm --filter @keykeykey/extension typecheck
pnpm --filter @keykeykey/extension lint
pnpm --filter @keykeykey/extension test
```

Expected: all pass. The file has no existing test file (grep `clipboard.test.ts` — confirmed absent), and the other test files don't import it.

- [ ] **Step 3: Rebuild both targets**

Run:

```bash
pnpm --filter @keykeykey/extension build
```

Expected: both builds succeed. The `offscreen` input is still listed in `vite.config.ts`, so Firefox will still build an `offscreen/clipboard-clear.html` artifact — the Firefox manifest doesn't reference it, and `web-ext lint` ignores unreferenced files, so this is fine.

- [ ] **Step 4: Commit**

```bash
git add apps/extension/src/background/clipboard.ts
git commit -m "feat(extension): clear clipboard via navigator.clipboard on Firefox"
```

---

## Task 6: Documentation updates (`.env.example` + README)

**Files:**

- Modify: `apps/extension/.env.example`
- Modify: `apps/extension/README.md`

### Context

The `.env.example` should document where the Firefox OAuth redirect URL comes from, and the README install sections need to point at `dist-chrome/` and `dist-firefox/` instead of the legacy `dist/`.

- [ ] **Step 1: Add a comment to `apps/extension/.env.example`**

Open `apps/extension/.env.example`. Replace the whole file with:

```bash
VITE_GOOGLE_CLIENT_ID_CHROME=changeme
VITE_GOOGLE_CLIENT_ID_SAFARI=changeme

# Firefox extension OAuth clients. The Firefox redirect URL is derived from
# the gecko.id "keykeykey@keykeykey.app" (see apps/extension/manifest.firefox.json):
#   https://3c49e7b76ea3e960825fdf27877252c3f6775139.extensions.allizom.org/
# Register this URL as an authorized redirect URI with each provider.
VITE_GOOGLE_CLIENT_ID_FIREFOX=changeme

VITE_DROPBOX_CLIENT_ID_CHROME=changeme
VITE_DROPBOX_CLIENT_ID_FIREFOX=changeme

VITE_ONEDRIVE_CLIENT_ID_CHROME=changeme
VITE_ONEDRIVE_CLIENT_ID_FIREFOX=changeme
```

- [ ] **Step 2: Update README Chrome install section**

Open `apps/extension/README.md`. Find the Chrome install section — it contains instructions like "Navigate to `apps/extension/dist/` inside the keykeykey repository". Replace every reference to `apps/extension/dist/` in the Chrome section with `apps/extension/dist-chrome/`.

Specifically, find this text (around Step 4 of "Installing in Chrome"):

```
2. Navigate to `apps/extension/dist/` inside the keykeykey repository
3. Select the `dist` folder and click **"Select"** (or **"Open"** on some systems)
```

Replace with:

```
2. Navigate to `apps/extension/dist-chrome/` inside the keykeykey repository
3. Select the `dist-chrome` folder and click **"Select"** (or **"Open"** on some systems)
```

Also find the "Updating after code changes" subsection for Chrome. The current build command is:

```bash
pnpm --filter @keykeykey/extension build
```

Change it to:

```bash
pnpm --filter @keykeykey/extension build:chrome
```

- [ ] **Step 3: Update README Firefox install section**

In the same file, find the Firefox install section ("Installing in Firefox"). Find instructions that reference `apps/extension/dist/` and `dist/` and replace with `apps/extension/dist-firefox/` and `dist-firefox/`.

Specifically, find (Step 3 of "Installing in Firefox"):

```
2. Navigate to `apps/extension/dist/`
3. Select the **`manifest.json`** file inside `dist/` (not the folder — Firefox wants a file)
```

Replace with:

```
2. Navigate to `apps/extension/dist-firefox/`
3. Select the **`manifest.json`** file inside `dist-firefox/` (not the folder — Firefox wants a file)
```

Find the `web-ext run` command in the Firefox section:

```bash
web-ext run --source-dir dist/ --firefox-profile keykeykey-dev --keep-profile-changes
```

Replace with:

```bash
web-ext run --source-dir dist-firefox/ --firefox-profile keykeykey-dev --keep-profile-changes
```

Find the "Updating after code changes" for Firefox:

```bash
pnpm --filter @keykeykey/extension build
```

Replace with:

```bash
pnpm --filter @keykeykey/extension build:firefox
```

Add a new paragraph at the end of the Firefox install section (before "### Debugging" subsection) explaining the `gecko.id` behavior:

```
### A note on persistence

The Firefox build sets a stable `browser_specific_settings.gecko.id` of
`keykeykey@keykeykey.app`. This means `browser.storage.local` persists across
extension reloads during development — you won't lose your vault when you
click "Reload" on `about:debugging`. The gecko.id also drives the OAuth
redirect URL (`https://3c49e7b76ea3e960825fdf27877252c3f6775139.extensions.allizom.org/`),
which is why OAuth providers must have that exact URL registered.
```

- [ ] **Step 4: Update README Safari install section**

Still in the same file, find the Safari install section ("Installing in Safari"). The `xcrun safari-web-extension-converter` command points at `apps/extension/dist/`. Replace both occurrences with `apps/extension/dist-chrome/` (Safari's converter accepts Chrome-style manifests cleanly).

Find (Step 2 of "Installing in Safari"):

```bash
xcrun safari-web-extension-converter apps/extension/dist/ \
```

Replace with:

```bash
xcrun safari-web-extension-converter apps/extension/dist-chrome/ \
```

Do the same for the "Updating after code changes" block in the Safari section. Also change the build command from `pnpm --filter @keykeykey/extension build` to `pnpm --filter @keykeykey/extension build:chrome`.

Add a short note below the Safari install heading:

```
> Safari currently uses the Chrome build (`dist-chrome/`). A dedicated Safari
> target may be added in the future — Safari's OAuth limitations (no
> `launchWebAuthFlow`) make the Chrome manifest close enough for now.
```

- [ ] **Step 5: Update the "Cross-browser" bullet in the Features section**

Still in `apps/extension/README.md`. The Features section near the top contains a bullet that lists supported browsers. Find the existing "Cross-browser" bullet:

```
- Cross-browser: Chrome, Firefox, Safari via `webextension-polyfill`
```

Replace with:

```
- Cross-browser: Chrome, Firefox, Safari via `webextension-polyfill`. Firefox
  and Chrome are produced as separate `dist-firefox/` and `dist-chrome/` builds.
```

- [ ] **Step 6: Run a final full build to confirm the docs instructions match reality**

Run:

```bash
pnpm --filter @keykeykey/extension clean
pnpm --filter @keykeykey/core --filter @keykeykey/ui build
pnpm --filter @keykeykey/extension build
ls apps/extension/dist-chrome/ apps/extension/dist-firefox/
```

Expected: both directories exist and contain `manifest.json`, `icons/`, `background/index.js`, `content/index.js`, etc.

- [ ] **Step 7: Commit**

```bash
git add apps/extension/.env.example apps/extension/README.md
git commit -m "docs(extension): document Firefox gecko.id + dist-chrome/dist-firefox paths"
```

---

## Task 7: Manual verification plan (no code)

**Files:** None (manual testing)

### Context

The spec's Section 5 defines a 15-step manual verification plan. This task is the checklist — run it against a fresh Firefox profile. Do not skip steps, and do not reorder them. If any step fails, stop and fix before proceeding.

Prerequisite: You need actual Firefox OAuth client IDs for Google / Dropbox / OneDrive in `apps/extension/.env` (the user confirmed these are registered; the values are not committed to the repo). The build will proceed without them but OAuth flows will fail with `invalid_client`.

- [ ] **Step 1: Clean build**

```bash
pnpm --filter @keykeykey/extension clean
pnpm --filter @keykeykey/core --filter @keykeykey/ui build
pnpm --filter @keykeykey/extension build
```

Expected: both `dist-chrome/` and `dist-firefox/` produced with no errors.

- [ ] **Step 2: `web-ext lint` clean**

```bash
pnpm --filter @keykeykey/extension lint:manifest:firefox
```

Expected: 0 errors.

- [ ] **Step 3: Load in Firefox**

Open Firefox → navigate to `about:debugging#/runtime/this-firefox` → click "Load Temporary Add-on" → select `apps/extension/dist-firefox/manifest.json` → verify the extension appears in the list with no errors in the inspector.

Expected: no manifest errors. The inspector link should open the background console without errors.

- [ ] **Step 4: Gecko ID sanity**

In the Firefox background debugger console (opened via the "Inspect" link on `about:debugging`), run:

```js
await browser.identity.getRedirectURL();
```

Expected output: `"https://3c49e7b76ea3e960825fdf27877252c3f6775139.extensions.allizom.org/"`

If the hash differs, `gecko.id` is wrong or the manifest override didn't apply. Go back to Task 2 and fix the manifest.

- [ ] **Step 5: Create vault**

Click the extension toolbar icon → Setup Screen → enter a master password → confirm → create. Wait ~15-20 seconds for Argon2id to complete.

Expected: vault created, unlocked, landed on the main screen.

- [ ] **Step 6: Lock + unlock round-trip**

Click lock → click unlock → enter master password → unlock.

Expected: vault unlocks successfully with the same password.

- [ ] **Step 7: PIN setup + unlock round-trip**

Open Settings → Set up PIN → enter 4-6 digit PIN → confirm. Lock. Unlock with PIN instead of master password.

Expected: PIN unlock succeeds.

- [ ] **Step 8: Add credential + clipboard auto-clear**

Add a new credential (name: "Test", URL: "https://example.com", username: "tester", password: "hunter2-test"). Save. On the item detail view, click "Copy password". Wait 35 seconds. Paste into Firefox's URL bar (or any text field).

Expected: paste is empty (clipboard cleared). If paste still contains `hunter2-test`, the Firefox branch in `clipboard.ts` is not executing or `clipboardWrite` permission is missing.

Debug hint: check the background console for any error after ~30s. A `NotAllowedError` from `navigator.clipboard.writeText` means the permission isn't granted.

- [ ] **Step 9: WebDAV sync round-trip**

Requires a local WebDAV server. If you don't have one running, install and run `webdav-server` or any quick local WebDAV provider on port 8080.

NOTE: To allow testing against a local-network WebDAV server, temporarily bypass the security guards per `CLAUDE.md` (add `http://192.168.` to the allowed URL prefixes in `packages/core/src/sync/webdav-adapter.ts` and comment out the `192.168.0.0/16` block in `apps/desktop/src-tauri/src/http_proxy.rs`). **Revert these before committing.** Search for `LOCAL TESTING ONLY` to find the changes.

In the extension popup: Settings → Sync → WebDAV → enter URL, username, password → enter master password → Connect. Wait for initial sync.

Expected: sync succeeds, no error banner, "Last synced" timestamp updates. Add an item, wait a few seconds, verify the item appears in the WebDAV server's storage.

- [ ] **Step 10: Dropbox OAuth round-trip**

Disconnect WebDAV. Settings → Sync → Dropbox → Connect. A Firefox OAuth popup should open to `dropbox.com/oauth2/authorize` → sign in / allow → redirect back → Firefox popup closes. Wait for sync.

Expected: sync succeeds. Disconnect and reconnect — should work without error.

After connecting, click extension icon → check `storage.local` for `sync_config_encrypted`:

```js
// In background debugger console
await browser.storage.local.get('sync_config_encrypted');
```

Expected: key exists.

Reload the extension via `about:debugging` → verify Dropbox still shows as connected and data is still present.

- [ ] **Step 11: OneDrive OAuth round-trip**

Disconnect Dropbox. Repeat Step 10 with OneDrive.

- [ ] **Step 12: Google Drive OAuth round-trip**

Disconnect OneDrive. Settings → Sync → Google Drive → Connect. A Firefox OAuth popup should open to `accounts.google.com/o/oauth2/v2/auth` → sign in / allow → redirect back to `https://3c49e7b7....extensions.allizom.org/` → popup closes.

Expected: sync succeeds. The stored `SyncConfig.googleDrive.refreshToken` should be a real Google refresh token (not `'chrome-identity'`).

Verify:

```js
// In background debugger console
const enc = (await browser.storage.local.get('sync_config_encrypted')).sync_config_encrypted;
// Can't decrypt without DEK, but confirm the blob exists
console.log('encrypted blob length:', enc.length);
```

Force a sync by adding a new item. Expected: sync succeeds. The core's `createCachedTokenProvider` uses the stored refresh token to get an access token, no adapter override on Firefox.

If Google OAuth fails with `invalid_client`:

- Check `VITE_GOOGLE_CLIENT_ID_FIREFOX` in `.env` is set to the real client ID (not `changeme`).
- Check the Google Cloud Console has `https://3c49e7b76ea3e960825fdf27877252c3f6775139.extensions.allizom.org/` registered as an authorized redirect URI for that client.
- Check the client type is "Web application" (not "Desktop" or "Chrome extension").

- [ ] **Step 13: Autofill injection**

Disconnect Google Drive (or not — sync is orthogonal to autofill). Add a credential for `https://the-internet.herokuapp.com/login` (username: `tomsmith`, password: `SuperSecretPassword!`). Visit that URL.

Expected: the KeyKeyKey autofill icon appears inside or beside the username field. Click the icon → credential picker appears → click the credential → username and password fields populate. Submit the form → login succeeds on the test site.

- [ ] **Step 14: Import / export round-trip**

Open the extension popup → Settings → Import → select a Chrome-format CSV file (you can export one from `chrome://settings/passwords` or use `e2e/fixtures/` if there's a test CSV there). Import.

Expected: items appear in the list, no errors.

Settings → Export → export to CSV → open the CSV file → verify the imported items are present.

- [ ] **Step 15: Storage persistence across restart**

Add a couple of items. Close Firefox completely (Cmd+Q on macOS). Reopen Firefox. Navigate to `about:debugging#/runtime/this-firefox` → Load Temporary Add-on → select `dist-firefox/manifest.json` again (temporary add-ons are forgotten on restart).

Expected: the vault header, items, and sync config are all still present. This is the test that would have failed without a stable `gecko.id`.

**If any of steps 1-15 fail, stop and fix before shipping.** Do not check in broken behavior assuming manual fix-up later.

---

## Summary of commits (after all tasks)

```
refactor(extension): consolidate detectBrowser into shared browser-detect helper
build(extension): dual-target Chrome + Firefox build
chore(extension): drop @types/chrome + enforce browser.* via ESLint
feat(extension): add Firefox Google OAuth via PKCE launchWebAuthFlow
feat(extension): clear clipboard via navigator.clipboard on Firefox
docs(extension): document Firefox gecko.id + dist-chrome/dist-firefox paths
```

One final PR grouping them all. Manual verification (Task 7) is not a commit — it's a gate before opening the PR.
