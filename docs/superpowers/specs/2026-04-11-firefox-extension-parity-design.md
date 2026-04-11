# Firefox Extension Parity Design

**Date:** 2026-04-11
**Status:** Approved

Brings the Firefox browser extension to feature parity with the Chrome extension, which has received dozens of commits of fixes and features over the past weeks. All functional code (storage, background, content scripts, popup, sync adapters, autofill, import/export) already uses the cross-browser `browser.*` namespace via `webextension-polyfill` and works in Firefox without modification. The remaining gaps are Chrome-only APIs and manifest fields.

## Scope

**In scope:**

- Dual-target Vite build producing `dist-chrome/` and `dist-firefox/`.
- Firefox-specific `manifest.json` with `browser_specific_settings.gecko.id`, without Chrome-only fields.
- Google OAuth Firefox path (PKCE via `launchWebAuthFlow`), branched at runtime.
- Clipboard auto-clear Firefox path (direct `navigator.clipboard.writeText('')` from background), branched at runtime.
- Minor cleanup: consolidated `detectBrowser()` helper, removed `@types/chrome`, ESLint rule preventing new `chrome.*` usages, README updates.
- Manual verification plan.

**Out of scope:**

- Safari. Safari still requires a native `ASWebAuthenticationSession` bridge for OAuth and is unaffected by this work.
- Firefox E2E test harness. Documented as a follow-up in `2026-04-11-firefox-e2e-design.md`.
- New Chrome features or refactors unrelated to Firefox porting.
- Migrating pre-existing Firefox installs. No meaningful install base exists.

## Current State (Evaluation)

The codebase is already mostly cross-browser:

| Area                      | State                                                                                                     |
| ------------------------- | --------------------------------------------------------------------------------------------------------- |
| `browser.*` vs `chrome.*` | 104 `browser.*` usages across 17 files vs 4 remaining `chrome.*` references (all in Google OAuth)         |
| Dropbox OAuth             | Already uses `launchWebAuthFlow` + PKCE + per-browser client IDs + `detectBrowser()`                      |
| OneDrive OAuth            | Same — already cross-browser                                                                              |
| WebDAV sync               | Fully cross-browser                                                                                       |
| `storage.ts`              | Uses `browser.storage.local` throughout                                                                   |
| `message-handler.ts`      | Uses `browser.runtime.onMessage`, one lingering `chrome.identity` comment                                 |
| `background/index.ts`     | Uses `browser.runtime`, `browser.tabs`, `browser.alarms`                                                  |
| Content scripts           | Use `browser.runtime.sendMessage` via polyfill                                                            |
| Popup                     | Uses `browser.runtime.sendMessage` via polyfill                                                           |
| Import / export           | Pure TypeScript, no browser APIs                                                                          |
| Password generator        | Pure TypeScript, no browser APIs                                                                          |
| `@types/chrome`           | Present in `devDependencies`; encourages accidental Chrome-isms and should be removed                     |

Firefox-blocking gaps:

1. **Single `manifest.json`** — Chrome-only fields (`key`, `oauth2`, `offscreen` permission) prevent a clean Firefox build; no `browser_specific_settings.gecko.id` means Firefox can't persist `storage.local` across reloads.
2. **Google OAuth** — `apps/extension/src/lib/google-oauth.ts` uses `chrome.identity.getAuthToken` exclusively. Firefox has no equivalent and needs the PKCE flow via `launchWebAuthFlow`, matching Dropbox/OneDrive.
3. **Clipboard auto-clear** — `apps/extension/src/background/clipboard.ts` uses Chrome's `offscreen` API. Firefox has no offscreen API; the current optional-chain `?.` silently degrades — Firefox users' clipboard never clears after copy.
4. **Vite build** — `copyManifest()` plugin emits a single `dist/manifest.json` with no target awareness.
5. **Playwright** — extension test project only targets Chromium.

## Gecko ID

Confirmed against the existing OAuth redirect URL registered in Google Cloud Console:

```
gecko.id:  keykeykey@keykeykey.app
SHA-1:     3c49e7b76ea3e960825fdf27877252c3f6775139
Redirect:  https://3c49e7b76ea3e960825fdf27877252c3f6775139.extensions.allizom.org/
```

The same redirect URL is assumed registered with Dropbox and OneDrive consoles. No OAuth console changes are required.

## 1. Dual-Target Build

### 1.1 Source Layout

```
apps/extension/
  manifest.json            ← base (shared fields)
  manifest.chrome.json     ← Chrome-only overrides
  manifest.firefox.json    ← Firefox-only overrides
  vite.config.ts           ← reads EXT_TARGET env var
```

`manifest.json` (base) contains fields both browsers share: `manifest_version`, `name`, `version`, `description`, `action`, `icons`, `content_scripts`, `host_permissions`. Everything else moves into per-target overrides.

### 1.2 Chrome Overrides

```json
{
  "key": "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAi6CVT65k8TxXFp9T0NcItujuN2eVtDjzANzFjIdZJX+7ysWE0SpnoUQteCGiJxTsqBLqx98JKiS3IG1IaqsE70w1Kh3q7sYNoI/lGM65cohC6/ViGE43fEX87ZQEc1Kr8N8rznaPj07Yf4whpLS54IWvdnLqTc4AA9Le3XfydaZdoATxNTYvHpfnfWBlh5hEzr0yKQmhgtR7YhKd9EMREvcKZhV3D5RF5wh1UrZKOxs+ObLX+z78FOhg+EGZR0rtCcrmaruItXbNBGWFfdTtBVbPAgbus5Nbtju9YO4lQJKTj+9//u0HxDJ5OL121l+YNMVVnsRnu6IugI2nEb6kHQIDAQAB",
  "oauth2": {
    "client_id": "960196785492-54nhfo9h2f8ef90j4srjdsa7tvsl4jdq.apps.googleusercontent.com",
    "scopes": ["https://www.googleapis.com/auth/drive.appdata"]
  },
  "permissions": ["storage", "activeTab", "alarms", "windows", "offscreen", "tabs", "identity"],
  "background": {
    "service_worker": "background/index.js",
    "type": "module"
  }
}
```

### 1.3 Firefox Overrides

```json
{
  "browser_specific_settings": {
    "gecko": {
      "id": "keykeykey@keykeykey.app",
      "strict_min_version": "121.0"
    }
  },
  "permissions": ["storage", "activeTab", "alarms", "windows", "tabs", "identity", "clipboardWrite"],
  "background": {
    "scripts": ["background/index.js"],
    "type": "module"
  }
}
```

Differences from Chrome:

- **Dropped** `key` (Chrome-only, identifies the extension ID in dev).
- **Dropped** `oauth2` (Chrome-only, powers `getAuthToken`).
- **Dropped** `offscreen` permission (Chrome-only API).
- **Added** `browser_specific_settings.gecko.id` — required for Firefox to persist `storage.local` and for the stable OAuth redirect URL.
- **Added** `strict_min_version: "121.0"` — ensures MV3 event-page background support and modern `launchWebAuthFlow` behavior.
- **Added** `clipboardWrite` permission — required for `navigator.clipboard.writeText('')` from the background event page.
- **Background format** — `scripts: [...]` instead of `service_worker`. Firefox 121+ supports both, but `scripts` is the documented-stable path and runs as an event page (Firefox doesn't implement Chrome's service-worker-style termination model).

### 1.4 Vite Plugin Changes

Replace `copyManifest()` in `apps/extension/vite.config.ts` with a target-aware variant:

```ts
const TARGET = (process.env.EXT_TARGET ?? 'chrome') as 'chrome' | 'firefox';

const copyManifest = (): import('vite').Plugin => ({
  name: 'copy-manifest',
  closeBundle() {
    const base = JSON.parse(readFileSync(resolve(__dirname, 'manifest.json'), 'utf-8'));
    const overridesPath = resolve(__dirname, `manifest.${TARGET}.json`);
    const overrides = JSON.parse(readFileSync(overridesPath, 'utf-8'));
    const merged = deepMerge(base, overrides);

    // Rewrite built paths (same as today)
    merged.action.default_popup = 'src/popup/index.html';
    if (merged.background.service_worker) merged.background.service_worker = 'background/index.js';
    if (merged.background.scripts) merged.background.scripts = ['background/index.js'];
    merged.content_scripts[0].js = ['content/index.js'];

    // Copy icons
    const iconsDir = resolve(__dirname, 'icons');
    const distIconsDir = resolve(__dirname, `dist-${TARGET}/icons`);
    mkdirSync(distIconsDir, { recursive: true });
    for (const file of readdirSync(iconsDir)) {
      if (file.endsWith('.png')) copyFileSync(resolve(iconsDir, file), resolve(distIconsDir, file));
    }

    writeFileSync(resolve(__dirname, `dist-${TARGET}/manifest.json`), JSON.stringify(merged, null, 2));
  },
});
```

`vite.config.ts` `build.outDir` becomes `` `dist-${TARGET}` ``. The content-script sub-build already runs in `closeBundle` and must emit to `` `dist-${TARGET}/content` `` as well.

`deepMerge` is a ~15-line utility that recursively merges objects (with `Array`s replaced, not concatenated) — implemented inline in `vite.config.ts`. No new dependency.

### 1.5 Package Scripts

`apps/extension/package.json`:

```json
{
  "scripts": {
    "build:chrome":   "EXT_TARGET=chrome   vite build",
    "build:firefox":  "EXT_TARGET=firefox  vite build",
    "build":          "pnpm build:chrome && pnpm build:firefox",
    "lint:manifest":         "web-ext lint --source-dir dist-chrome",
    "lint:manifest:firefox": "web-ext lint --source-dir dist-firefox"
  }
}
```

`build` now produces both dists so CI covers both. Existing workflows calling `pnpm --filter @keykeykey/extension build` pick up both targets automatically.

### 1.6 Git Hygiene

Add to `apps/extension/.gitignore`:

```
dist-chrome/
dist-firefox/
```

Remove any prior `dist/` entry if present.

## 2. Google OAuth Firefox Path

### 2.1 New helper: `browser-detect.ts`

`apps/extension/src/lib/browser-detect.ts`:

```ts
export type BrowserKind = 'chrome' | 'firefox' | 'safari';

export function getBrowserKind(): BrowserKind {
  if (typeof navigator === 'undefined') return 'chrome';
  const ua = navigator.userAgent;
  if (ua.includes('Firefox')) return 'firefox';
  if (ua.includes('Safari') && !ua.includes('Chrome')) return 'safari';
  return 'chrome';
}
```

Replaces the two duplicate `detectBrowser()` functions in `dropbox-oauth.ts` and `onedrive-oauth.ts`. Both files import the new helper and use `getBrowserKind()` as the lookup key. Behavior identical; single source of truth.

### 2.2 Rewritten: `google-oauth.ts`

Key insight from reviewing `packages/core/src/sync/sync-config.ts:104-115`: `createAdapterFromConfig` **already** falls back to `createCachedTokenProvider(config.googleDrive.refreshToken, config.googleDrive.clientId)` when `adapterOverrides.googleDriveTokenProvider` is not passed. That means the Firefox path needs **no runtime token provider** in the extension at all — the core handles token refresh automatically once a real refresh token is in `SyncConfig.googleDrive`.

This simplifies the branching enormously:

- **Chrome** keeps passing the `googleDriveTokenProvider` override (calls `chrome.identity.getAuthToken` each time).
- **Firefox** passes no override. Core uses `config.googleDrive.refreshToken` + `config.googleDrive.clientId` via `createCachedTokenProvider` automatically.

What Firefox actually needs from `google-oauth.ts`:

1. `startGoogleOAuth()` that runs the PKCE flow and returns real `{ refreshToken, clientId }`.
2. `revokeGoogleToken(refreshToken)` that calls the core's `revokeToken` helper.

Chrome still needs the existing `startGoogleOAuth()` (which calls `getAuthToken` and returns `'chrome-identity'` placeholders), `getChromeGoogleAccessToken()` (used by the override), and `revokeGoogleToken()` (which uses `removeCachedAuthToken`).

Rewritten `apps/extension/src/lib/google-oauth.ts`:

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

export interface GoogleOAuthResult {
  refreshToken: string;
  clientId: string;
}

// ---------- Chrome-only helpers (existing, preserved) ----------

const identity = browser.identity as unknown as {
  getAuthToken: (opts: { interactive: boolean }) => Promise<unknown>;
  removeCachedAuthToken: (opts: { token: string }) => Promise<void>;
};

function extractToken(result: unknown): string | null {
  if (typeof result === 'string') return result;
  if (result && typeof result === 'object' && 'token' in result) {
    return (result as { token: string }).token;
  }
  return null;
}

/**
 * Chrome-only: fetch a fresh access token via chrome.identity.getAuthToken.
 * Used as the googleDriveTokenProvider adapter override on Chrome.
 * Not called on Firefox (core uses createCachedTokenProvider with the stored refresh token).
 */
export async function getChromeGoogleAccessToken(): Promise<string> {
  try {
    const cached = await identity.getAuthToken({ interactive: false });
    const cachedToken = extractToken(cached);
    if (cachedToken) await identity.removeCachedAuthToken({ token: cachedToken });
  } catch {}
  const result = await identity.getAuthToken({ interactive: false });
  const token = extractToken(result);
  if (!token) throw new Error('Failed to get Google access token — user may need to re-authenticate');
  return token;
}

// ---------- Dispatched: startGoogleOAuth + revokeGoogleToken ----------

async function startGoogleOAuthChrome(): Promise<GoogleOAuthResult> {
  const result = await identity.getAuthToken({ interactive: true });
  const token = extractToken(result);
  if (!token) throw new Error('Google sign-in failed — no token received');
  // Chrome uses placeholder values — the adapter override calls getAuthToken
  // directly via getChromeGoogleAccessToken, so the stored refreshToken/clientId
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
  if (!callbackUrl) throw new Error('No response URL from OAuth flow');

  const url = new URL(callbackUrl);
  if (url.searchParams.get('state') !== state) {
    throw new Error('OAuth state mismatch — possible CSRF attack');
  }
  const code = url.searchParams.get('code');
  if (!code) throw new Error('No authorization code in OAuth redirect');

  const tokens = await exchangeGoogleAuthCode({
    code,
    clientId: GOOGLE_CLIENT_ID_FIREFOX,
    redirectUri,
    codeVerifier,
    // no clientSecret — Firefox extension client is registered as a public PKCE client
  });

  return { refreshToken: tokens.refreshToken, clientId: GOOGLE_CLIENT_ID_FIREFOX };
}

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

// ---------- Public API (dispatched at module load) ----------

const isFirefox = getBrowserKind() === 'firefox';

export const startGoogleOAuth = isFirefox ? startGoogleOAuthFirefox : startGoogleOAuthChrome;

export async function revokeGoogleToken(refreshToken?: string): Promise<void> {
  if (isFirefox) return revokeGoogleTokenFirefox(refreshToken);
  return revokeGoogleTokenChrome();
}
```

Notes:

- `getChromeGoogleAccessToken` remains a top-level named export so `sync.ts` can pass it as an adapter override on Chrome (same as today).
- `revokeGoogleToken` now accepts an optional `refreshToken` so the Firefox path can call `coreRevokeToken(refreshToken)`. Chrome ignores the argument.
- Message handler call sites pass `config.googleDrive?.refreshToken` to `revokeGoogleToken()`.

### 2.3 Call Site Changes

**`apps/extension/src/background/sync.ts:71`** — Currently always passes `getChromeGoogleAccessToken` as the `googleDriveTokenProvider` override. Branch: pass it only on Chrome. On Firefox, pass `undefined` so the core falls through to its default `createCachedTokenProvider(config.googleDrive.refreshToken, config.googleDrive.clientId)` path.

```ts
// apps/extension/src/background/sync.ts
import { getChromeGoogleAccessToken } from '../lib/google-oauth.js';
import { getBrowserKind } from '../lib/browser-detect.js';

// inside initLifecycle():
lifecycle = new SyncLifecycle({
  store,
  storage: createExtensionPlatformStorage(),
  callbacks: { /* unchanged */ },
  getHeader,
  adapterOverrides:
    getBrowserKind() === 'chrome'
      ? { googleDriveTokenProvider: getChromeGoogleAccessToken }
      : undefined,
});
```

No change to the core. No other places instantiate `GoogleDriveAdapter` in the extension — `sync.ts:71` is the single wiring point.

**`apps/extension/src/background/message-handler.ts:1060` (`GOOGLE_OAUTH_CONNECT`)** — Currently hardcodes `googleDrive: { refreshToken: 'chrome-identity', clientId: 'chrome-identity' }` in the SyncConfig it persists. Capture the real return value from `startGoogleOAuth()` instead:

```ts
const { refreshToken, clientId } = await startGoogleOAuth();
const config: SyncConfig = {
  provider: 'google-drive',
  masterPassword: message.masterPassword,
  googleDrive: { refreshToken, clientId },
};
// ...existing lifecycle.saveConfig(config), triggerSync(), etc.
```

On Chrome, `startGoogleOAuth()` still returns `{ refreshToken: 'chrome-identity', clientId: 'chrome-identity' }` — Chrome's stored SyncConfig is unchanged. On Firefox, real tokens are persisted and used by the core's default `createCachedTokenProvider` path on subsequent syncs.

**`apps/extension/src/background/message-handler.ts:1124` (`GOOGLE_OAUTH_GET_TOKEN`)** — This handler is called during the restore flow (no vault header yet), and returns tokens to the popup directly rather than persisting a SyncConfig. Currently hardcoded to `{ refreshToken: 'chrome-identity', clientId: 'chrome-identity' }`. Capture and return the real values from `startGoogleOAuth()`:

```ts
const tokens = await startGoogleOAuth();
await browser.storage.local.set({ last_connected_provider: { /* unchanged */ } });
return tokens; // { refreshToken, clientId } — real on Firefox, placeholder on Chrome
```

Update the existing "placeholder values — adapter uses chrome.identity.getAuthToken directly" comment to describe the Chrome-vs-Firefox split. The popup takes these values, builds a one-off SyncConfig for the restore fetch, and relies on the same Chrome override / Firefox default token-provider split at `sync.ts:71`.

**`apps/extension/src/background/message-handler.ts:1133` (`GOOGLE_OAUTH_DISCONNECT`)** — Currently calls `revokeGoogleToken()` with no args. Firefox needs the stored refresh token passed through:

```ts
const currentConfig = getCurrentConfig();
await revokeGoogleToken(currentConfig?.googleDrive?.refreshToken);
```

On Chrome, the argument is ignored (Chrome path uses `removeCachedAuthToken` on the currently-cached token instead). On Firefox, the argument is required for the revoke endpoint call.

### 2.4 RestoreScreen shortcut

`apps/extension/src/popup/screens/RestoreScreen.tsx:20` comment and the "Google skips straight to password step" shortcut logic is Chrome-specific (it assumes `getAuthToken` silent consent is available before the user types their master password). On Firefox, Google must flow through the same connect step as Dropbox/OneDrive — master password entered first, then OAuth popup.

Branch:

```ts
const skipToMasterPassword = provider === 'google-drive' && getBrowserKind() === 'chrome';
```

Applied to the existing shortcut logic. Comment updated.

### 2.5 Env Vars

Already present in `.env.example`:

```
VITE_GOOGLE_CLIENT_ID_FIREFOX=changeme
VITE_DROPBOX_CLIENT_ID_FIREFOX=changeme
VITE_ONEDRIVE_CLIENT_ID_FIREFOX=changeme
```

No new env vars. All Firefox OAuth clients are already registered with the correct `https://3c49e7b7....extensions.allizom.org/` redirect URL.

## 3. Clipboard Auto-Clear Firefox Path

`apps/extension/src/background/clipboard.ts`:

```ts
import browser from 'webextension-polyfill';
import { getBrowserKind } from '../lib/browser-detect.js';

const CLIPBOARD_ALARM = 'clipboard-clear';

export function setupClipboardClear(): void {
  browser.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name !== CLIPBOARD_ALARM) return;

    if (getBrowserKind() === 'firefox') {
      // Firefox MV3 event pages can call Clipboard API directly
      try {
        await navigator.clipboard.writeText('');
      } catch {
        // Clipboard API may reject if the document isn't focused.
        // Acceptable — clipboard auto-clear is best-effort security hardening.
      }
      return;
    }

    // Chrome path (unchanged): spin up an offscreen document
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

export function scheduleClipboardClear(): void {
  browser.alarms.clear(CLIPBOARD_ALARM);
  browser.alarms.create(CLIPBOARD_ALARM, { delayInMinutes: 0.5 });
}
```

The `clipboardWrite` permission in the Firefox manifest satisfies the Clipboard API requirement. Chrome's permission set is unchanged.

Note on Firefox background Clipboard API: Firefox 121+ allows `navigator.clipboard.writeText` from an event page context when `clipboardWrite` is granted, without requiring a focused document for write (read is stricter). Writing an empty string is permitted. The `try`/`catch` handles rare edge cases (e.g., browser shutting down mid-alarm).

## 4. Minor Cleanup

### 4.1 Remove `@types/chrome`

`apps/extension/package.json` `devDependencies` drops `"@types/chrome"`. The codebase uses `@types/webextension-polyfill` types accessed through `import browser from 'webextension-polyfill'`. Removing `@types/chrome` prevents accidental `chrome.*` typechecks — any such reference becomes a compile error, not a runtime surprise.

Risk: any place that imports from `chrome` at the type level will break. Grep finds only the two Chrome OAuth call sites (`google-oauth.ts`), which are intentional runtime-guarded Chrome-only paths. They already use `(browser.identity as unknown as {...})` casts, so removing `@types/chrome` should not affect them. If a few stray `chrome.foo` type references surface, they become part of the porting PR (expected to be zero or close to it).

### 4.2 ESLint rule

`apps/extension/eslint.config.js` gains a `no-restricted-globals` rule disallowing `chrome` outside `google-oauth.ts`:

```js
{
  files: ['src/**/*.ts', 'src/**/*.tsx'],
  ignores: ['src/lib/google-oauth.ts'],
  rules: {
    'no-restricted-globals': ['error', {
      name: 'chrome',
      message: 'Use the browser namespace from webextension-polyfill instead.',
    }],
  },
},
```

Prevents regression when future commits accidentally reach for `chrome.*`.

### 4.3 README updates

`apps/extension/README.md` install sections updated:

- **Chrome section:** `Load unpacked → dist-chrome/` (was `dist/`).
- **Firefox section:** `Load Temporary Add-on → dist-firefox/manifest.json` (was `dist/manifest.json`). Add note that Firefox now has a stable `gecko.id` so `storage.local` persists across reloads.
- **Safari section:** Safari converter runs against `dist-chrome/` (Safari is closer to Chrome's manifest format). Add a TODO note that a dedicated Safari target may be needed later.

### 4.4 `.env.example` note

Add a comment above the Firefox block:

```
# Firefox extension client IDs. The OAuth redirect URL is derived from
# the gecko.id "keykeykey@keykeykey.app":
#   https://3c49e7b76ea3e960825fdf27877252c3f6775139.extensions.allizom.org/
VITE_GOOGLE_CLIENT_ID_FIREFOX=changeme
VITE_DROPBOX_CLIENT_ID_FIREFOX=changeme
VITE_ONEDRIVE_CLIENT_ID_FIREFOX=changeme
```

## 5. Verification Plan (Manual)

Run sequentially against a fresh Firefox profile after implementing:

1. **Build clean.** `pnpm --filter @keykeykey/extension clean && pnpm --filter @keykeykey/extension build` produces both `dist-chrome/` and `dist-firefox/` with no errors.
2. **`web-ext lint` passes.** `pnpm --filter @keykeykey/extension lint:manifest:firefox` reports no errors.
3. **Load in Firefox.** `about:debugging#/runtime/this-firefox` → Load Temporary Add-on → select `dist-firefox/manifest.json`. Extension loads without errors in the debugging console.
4. **Gecko ID sanity.** In the background debugger console: `browser.identity.getRedirectURL()` returns `https://3c49e7b76ea3e960825fdf27877252c3f6775139.extensions.allizom.org/`.
5. **Create vault.** Set master password → round-trip encrypt/decrypt works.
6. **Lock / unlock.** Password unlock works.
7. **PIN setup + unlock.** PIN round-trip works.
8. **Add credential + copy.** Add a credential, copy the password, wait 35s, paste → clipboard is empty (clipboard auto-clear fired).
9. **WebDAV sync.** Connect a local WebDAV server → initial sync → add an item → second sync → data present on server.
10. **Dropbox OAuth.** Connect → OAuth popup → sync → `sync_config_encrypted` persists in `storage.local` → reload extension → still connected.
11. **OneDrive OAuth.** Same as Dropbox.
12. **Google Drive OAuth.** Same flow. Verify: OAuth popup shows `accounts.google.com`, redirect lands on the allizom URL, token exchange succeeds, initial sync fires, `SyncConfig.googleDrive.refreshToken` is stored encrypted, subsequent token refresh via the core's `createCachedTokenProvider` (no adapter override on Firefox) works.
13. **Autofill.** Visit a test login form → autofill icon injects → click → credential fills → submit → save prompt.
14. **Import / export.** Import a Chrome CSV → items appear → sync fires → export to CSV → round-trip OK.
15. **Close and reopen Firefox.** Reload the extension via `about:debugging` → vault header, items, and sync config all still present. (This is the test that would have failed without `gecko.id`.)

If any step fails, fix before proceeding. No implicit step reordering — the list is the checklist.

## 6. Non-Goals (Explicit)

- No Safari work. Safari OAuth still blocked by lack of `launchWebAuthFlow` support; out of scope.
- No Firefox E2E harness. Follow-up spec at `2026-04-11-firefox-e2e-design.md`.
- No new features in Firefox that don't exist in Chrome.
- No changes to Chrome runtime behavior. The only Chrome-visible delta is the dist path (`dist-chrome/` replaces `dist/`) and the removal of `@types/chrome`.
- No Firefox install-base migration. No meaningful users exist to migrate.
- No refactors or improvements unrelated to Firefox porting.

## 7. Files Touched (Summary)

```
apps/extension/
  manifest.json                                   [MODIFIED — strip to base fields]
  manifest.chrome.json                            [NEW]
  manifest.firefox.json                           [NEW]
  vite.config.ts                                  [MODIFIED — EXT_TARGET-aware build]
  package.json                                    [MODIFIED — new scripts, drop @types/chrome]
  .gitignore                                      [MODIFIED — dist-chrome/, dist-firefox/]
  .env.example                                    [MODIFIED — gecko.id comment]
  README.md                                       [MODIFIED — install paths]
  eslint.config.js                                [MODIFIED — no-restricted-globals chrome]
  src/lib/browser-detect.ts                       [NEW — shared getBrowserKind()]
  src/lib/google-oauth.ts                         [MODIFIED — Chrome + Firefox paths]
  src/lib/dropbox-oauth.ts                        [MODIFIED — use shared detector]
  src/lib/onedrive-oauth.ts                       [MODIFIED — use shared detector]
  src/background/clipboard.ts                     [MODIFIED — Firefox branch]
  src/background/sync.ts                          [MODIFIED — conditional adapterOverrides]
  src/background/message-handler.ts               [MODIFIED — real Google OAuth tokens + revoke]
  src/popup/screens/RestoreScreen.tsx             [MODIFIED — Chrome-only shortcut guard]
```

One new file in docs:

```
docs/superpowers/specs/2026-04-11-firefox-extension-parity-design.md   [this file]
docs/superpowers/specs/2026-04-11-firefox-e2e-design.md                 [follow-up reference]
```
