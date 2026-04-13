# Extension OAuth Consolidation (PR1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move extension OAuth files from flat `lib/` to `lib/oauth/` subdirectory, extract the shared `launchWebAuthFlow` pattern into a reusable helper, and update all import sites.

**Architecture:** The extension's three OAuth files (`google-oauth.ts`, `dropbox-oauth.ts`, `onedrive-oauth.ts`) already delegate token exchange, refresh, and revocation to `@keykeykey/core/sync`. The Dropbox and OneDrive files share an identical `launchWebAuthFlow → verify state → extract code → exchange` pattern. We extract that pattern into a shared helper, move everything into `lib/oauth/`, add a barrel export, and update the two import sites (`message-handler.ts`, `sync.ts`).

**Tech Stack:** TypeScript, webextension-polyfill, `@keykeykey/core/sync` OAuth module, Vitest

---

### Task 1: Create shared `launchOAuthFlow` helper

**Files:**

- Create: `apps/extension/src/lib/oauth/launch-flow.ts`

- [ ] **Step 1: Write the test**

Create the test file:

```typescript
// apps/extension/src/lib/oauth/launch-flow.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { launchOAuthFlow } from './launch-flow.js';

// Mock webextension-polyfill
vi.mock('webextension-polyfill', () => ({
  default: {
    identity: {
      getRedirectURL: () => 'https://redirect.test/',
      launchWebAuthFlow: vi.fn(),
    },
  },
}));

import browser from 'webextension-polyfill';

describe('launchOAuthFlow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return the exchange result on success', async () => {
    const mockBuildUrl = vi.fn().mockResolvedValue('https://auth.example.com?state=abc123');
    const mockExchange = vi.fn().mockResolvedValue({ refreshToken: 'rt_123', accessToken: 'at' });

    vi.mocked(browser.identity.launchWebAuthFlow).mockResolvedValue(
      'https://redirect.test/?code=AUTH_CODE&state=abc123',
    );

    const result = await launchOAuthFlow({
      buildAuthUrl: mockBuildUrl,
      exchangeCode: mockExchange,
      clientId: 'client-123',
    });

    expect(result).toEqual({ refreshToken: 'rt_123', accessToken: 'at' });
    expect(mockBuildUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: 'client-123',
        redirectUri: 'https://redirect.test/',
      }),
    );
    expect(mockExchange).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'AUTH_CODE',
        clientId: 'client-123',
        redirectUri: 'https://redirect.test/',
      }),
    );
  });

  it('should throw on state mismatch', async () => {
    const mockBuildUrl = vi.fn().mockResolvedValue('https://auth.example.com?state=expected');
    const mockExchange = vi.fn();

    vi.mocked(browser.identity.launchWebAuthFlow).mockResolvedValue(
      'https://redirect.test/?code=CODE&state=wrong',
    );

    await expect(
      launchOAuthFlow({
        buildAuthUrl: mockBuildUrl,
        exchangeCode: mockExchange,
        clientId: 'client-123',
      }),
    ).rejects.toThrow('OAuth state mismatch');
    expect(mockExchange).not.toHaveBeenCalled();
  });

  it('should throw when no callback URL is returned', async () => {
    const mockBuildUrl = vi.fn().mockResolvedValue('https://auth.example.com');
    vi.mocked(browser.identity.launchWebAuthFlow).mockResolvedValue('');

    await expect(
      launchOAuthFlow({
        buildAuthUrl: mockBuildUrl,
        exchangeCode: vi.fn(),
        clientId: 'client-123',
      }),
    ).rejects.toThrow('No response URL from OAuth flow');
  });

  it('should throw when no authorization code in redirect', async () => {
    const mockBuildUrl = vi.fn().mockResolvedValue('https://auth.example.com?state=abc');
    vi.mocked(browser.identity.launchWebAuthFlow).mockResolvedValue(
      'https://redirect.test/?state=abc',
    );

    await expect(
      launchOAuthFlow({
        buildAuthUrl: mockBuildUrl,
        exchangeCode: vi.fn(),
        clientId: 'client-123',
      }),
    ).rejects.toThrow('No authorization code');
  });

  it('should pass extraExchangeParams to exchangeCode', async () => {
    const mockBuildUrl = vi.fn().mockResolvedValue('https://auth.example.com?state=abc');
    const mockExchange = vi.fn().mockResolvedValue({ refreshToken: 'rt' });
    vi.mocked(browser.identity.launchWebAuthFlow).mockResolvedValue(
      'https://redirect.test/?code=CODE&state=abc',
    );

    await launchOAuthFlow({
      buildAuthUrl: mockBuildUrl,
      exchangeCode: mockExchange,
      clientId: 'client-123',
      extraExchangeParams: { clientSecret: 'secret' },
    });

    expect(mockExchange).toHaveBeenCalledWith(expect.objectContaining({ clientSecret: 'secret' }));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/davidneto/keykeykey && pnpm --filter @keykeykey/extension exec vitest run src/lib/oauth/launch-flow.test.ts`
Expected: FAIL — module `./launch-flow.js` not found

- [ ] **Step 3: Write the implementation**

```typescript
// apps/extension/src/lib/oauth/launch-flow.ts
import browser from 'webextension-polyfill';
import { generateCodeVerifier, generateState } from '@keykeykey/core/sync';

export interface LaunchOAuthFlowParams<T> {
  buildAuthUrl: (params: {
    clientId: string;
    redirectUri: string;
    codeVerifier: string;
    state: string;
  }) => Promise<string>;
  exchangeCode: (params: {
    code: string;
    clientId: string;
    redirectUri: string;
    codeVerifier: string;
    [key: string]: unknown;
  }) => Promise<T>;
  clientId: string;
  extraExchangeParams?: Record<string, string>;
}

/**
 * Shared OAuth flow for browser extensions:
 * 1. Generate PKCE verifier + state
 * 2. Build auth URL via provider-specific builder
 * 3. Launch browser.identity.launchWebAuthFlow
 * 4. Validate state, extract code
 * 5. Exchange code via provider-specific exchanger
 */
export async function launchOAuthFlow<T>(params: LaunchOAuthFlowParams<T>): Promise<T> {
  const { buildAuthUrl, exchangeCode, clientId, extraExchangeParams } = params;

  const codeVerifier = generateCodeVerifier();
  const state = generateState();
  const redirectUri = browser.identity.getRedirectURL();

  const authUrl = await buildAuthUrl({ clientId, redirectUri, codeVerifier, state });

  const callbackUrl = await browser.identity.launchWebAuthFlow({
    url: authUrl,
    interactive: true,
  });
  if (!callbackUrl) {
    throw new Error('No response URL from OAuth flow');
  }

  const url = new URL(callbackUrl);

  // Surface OAuth provider errors from redirect URL
  const oauthError = url.searchParams.get('error');
  if (oauthError) {
    const description = url.searchParams.get('error_description');
    throw new Error(description ? `OAuth failed: ${description}` : `OAuth failed: ${oauthError}`);
  }

  if (url.searchParams.get('state') !== state) {
    throw new Error('OAuth state mismatch — possible CSRF attack');
  }

  const code = url.searchParams.get('code');
  if (!code) {
    throw new Error('No authorization code in OAuth redirect');
  }

  return exchangeCode({
    code,
    clientId,
    redirectUri,
    codeVerifier,
    ...extraExchangeParams,
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/davidneto/keykeykey && pnpm --filter @keykeykey/extension exec vitest run src/lib/oauth/launch-flow.test.ts`
Expected: PASS (all 5 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/extension/src/lib/oauth/launch-flow.ts apps/extension/src/lib/oauth/launch-flow.test.ts
git commit -m "feat(extension): add shared launchOAuthFlow helper for browser OAuth"
```

---

### Task 2: Move and slim down Dropbox OAuth

**Files:**

- Create: `apps/extension/src/lib/oauth/dropbox.ts`
- Delete: `apps/extension/src/lib/dropbox-oauth.ts` (after imports updated)

- [ ] **Step 1: Create the new slimmed-down file**

```typescript
// apps/extension/src/lib/oauth/dropbox.ts
import {
  buildDropboxAuthUrl,
  exchangeDropboxAuthCode,
  revokeDropboxToken as coreRevokeDropboxToken,
} from '@keykeykey/core/sync';
import { getBrowserKind, type BrowserKind } from '../browser-detect.js';
import { launchOAuthFlow } from './launch-flow.js';

const DROPBOX_CLIENT_IDS: Record<BrowserKind, string> = {
  chrome: import.meta.env.VITE_DROPBOX_CLIENT_ID_CHROME ?? '',
  safari: import.meta.env.VITE_DROPBOX_CLIENT_ID_SAFARI ?? '',
  firefox: import.meta.env.VITE_DROPBOX_CLIENT_ID_FIREFOX ?? '',
};

export const DROPBOX_CLIENT_ID = DROPBOX_CLIENT_IDS[getBrowserKind()];

export async function startDropboxOAuth(): Promise<{ refreshToken: string }> {
  const result = await launchOAuthFlow({
    buildAuthUrl: (p) =>
      buildDropboxAuthUrl({
        clientId: p.clientId,
        redirectUri: p.redirectUri,
        codeVerifier: p.codeVerifier,
        state: p.state,
      }),
    exchangeCode: (p) =>
      exchangeDropboxAuthCode({
        code: p.code,
        clientId: p.clientId,
        redirectUri: p.redirectUri,
        codeVerifier: p.codeVerifier,
      }),
    clientId: DROPBOX_CLIENT_ID,
  });
  return { refreshToken: result.refreshToken };
}

export const revokeDropboxToken = coreRevokeDropboxToken;
```

- [ ] **Step 2: Create the new OneDrive file**

```typescript
// apps/extension/src/lib/oauth/onedrive.ts
import { buildOneDriveAuthUrl, exchangeOneDriveAuthCode } from '@keykeykey/core/sync';
import { getBrowserKind, type BrowserKind } from '../browser-detect.js';
import { launchOAuthFlow } from './launch-flow.js';

const ONEDRIVE_CLIENT_IDS: Record<BrowserKind, string> = {
  chrome: import.meta.env.VITE_ONEDRIVE_CLIENT_ID_CHROME ?? '',
  safari: import.meta.env.VITE_ONEDRIVE_CLIENT_ID_SAFARI ?? '',
  firefox: import.meta.env.VITE_ONEDRIVE_CLIENT_ID_FIREFOX ?? '',
};

export const ONEDRIVE_CLIENT_ID = ONEDRIVE_CLIENT_IDS[getBrowserKind()];

export async function startOneDriveOAuth(): Promise<{ refreshToken: string }> {
  const result = await launchOAuthFlow({
    buildAuthUrl: (p) =>
      buildOneDriveAuthUrl({
        clientId: p.clientId,
        redirectUri: p.redirectUri,
        codeVerifier: p.codeVerifier,
        state: p.state,
      }),
    exchangeCode: (p) =>
      exchangeOneDriveAuthCode({
        code: p.code,
        clientId: p.clientId,
        redirectUri: p.redirectUri,
        codeVerifier: p.codeVerifier,
      }),
    clientId: ONEDRIVE_CLIENT_ID,
  });
  return { refreshToken: result.refreshToken };
}
```

- [ ] **Step 3: Move Google OAuth**

Google is more complex (Chrome vs Firefox paths), so we move it mostly as-is but update it to use `launchOAuthFlow` for the Firefox path:

```typescript
// apps/extension/src/lib/oauth/google.ts
import browser from 'webextension-polyfill';
import {
  buildAuthUrl as buildGoogleAuthUrl,
  exchangeAuthCode as exchangeGoogleAuthCode,
  revokeToken as coreRevokeToken,
} from '@keykeykey/core/sync';
import { getBrowserKind } from '../browser-detect.js';
import { launchOAuthFlow } from './launch-flow.js';

const GOOGLE_CLIENT_ID_FIREFOX = import.meta.env.VITE_GOOGLE_CLIENT_ID_FIREFOX ?? '';
const GOOGLE_CLIENT_SECRET_FIREFOX = import.meta.env.VITE_GOOGLE_CLIENT_SECRET_FIREFOX ?? '';

/** Result of a successful `startGoogleOAuth()` call. */
export interface GoogleOAuthResult {
  refreshToken: string;
  clientId: string;
  clientSecret?: string;
}

// ---------------------------------------------------------------------------
// Chrome-only helpers
// ---------------------------------------------------------------------------

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
// startGoogleOAuth
// ---------------------------------------------------------------------------

async function startGoogleOAuthChrome(): Promise<GoogleOAuthResult> {
  const result = await identity.getAuthToken({ interactive: true });
  const token = extractToken(result);
  if (!token) {
    throw new Error('Google sign-in failed — no token received');
  }
  return { refreshToken: 'chrome-identity', clientId: 'chrome-identity' };
}

async function startGoogleOAuthFirefox(): Promise<GoogleOAuthResult> {
  const tokens = await launchOAuthFlow({
    buildAuthUrl: (p) =>
      buildGoogleAuthUrl({
        clientId: GOOGLE_CLIENT_ID_FIREFOX,
        redirectUri: p.redirectUri,
        codeVerifier: p.codeVerifier,
        state: p.state,
      }),
    exchangeCode: (p) =>
      exchangeGoogleAuthCode({
        code: p.code,
        clientId: GOOGLE_CLIENT_ID_FIREFOX,
        clientSecret: GOOGLE_CLIENT_SECRET_FIREFOX,
        redirectUri: p.redirectUri,
        codeVerifier: p.codeVerifier,
      }),
    clientId: GOOGLE_CLIENT_ID_FIREFOX,
  });

  return {
    refreshToken: tokens.refreshToken,
    clientId: GOOGLE_CLIENT_ID_FIREFOX,
    clientSecret: GOOGLE_CLIENT_SECRET_FIREFOX,
  };
}

// ---------------------------------------------------------------------------
// revokeGoogleToken
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

export const startGoogleOAuth = isFirefox ? startGoogleOAuthFirefox : startGoogleOAuthChrome;

export async function revokeGoogleToken(refreshToken?: string): Promise<void> {
  if (isFirefox) {
    return revokeGoogleTokenFirefox(refreshToken);
  }
  return revokeGoogleTokenChrome();
}
```

- [ ] **Step 4: Create barrel export**

```typescript
// apps/extension/src/lib/oauth/index.ts
export { startGoogleOAuth, revokeGoogleToken, getChromeGoogleAccessToken } from './google.js';
export type { GoogleOAuthResult } from './google.js';

export { startDropboxOAuth, revokeDropboxToken, DROPBOX_CLIENT_ID } from './dropbox.js';

export { startOneDriveOAuth, ONEDRIVE_CLIENT_ID } from './onedrive.js';

export { launchOAuthFlow } from './launch-flow.js';
export type { LaunchOAuthFlowParams } from './launch-flow.js';
```

- [ ] **Step 5: Run all extension tests to verify nothing breaks yet (old files still exist)**

Run: `cd /Users/davidneto/keykeykey && pnpm --filter @keykeykey/extension exec vitest run`
Expected: All existing tests PASS (new files exist alongside old ones)

- [ ] **Step 6: Commit**

```bash
git add apps/extension/src/lib/oauth/
git commit -m "feat(extension): create lib/oauth/ with shared helper and provider files"
```

---

### Task 3: Update import sites and delete old files

**Files:**

- Modify: `apps/extension/src/background/message-handler.ts:40-42`
- Modify: `apps/extension/src/background/sync.ts:9`
- Delete: `apps/extension/src/lib/google-oauth.ts`
- Delete: `apps/extension/src/lib/dropbox-oauth.ts`
- Delete: `apps/extension/src/lib/onedrive-oauth.ts`

- [ ] **Step 1: Update message-handler.ts imports**

Replace lines 40-42:

```typescript
// OLD:
import { startGoogleOAuth, revokeGoogleToken } from '../lib/google-oauth.js';
import { startDropboxOAuth, revokeDropboxToken, DROPBOX_CLIENT_ID } from '../lib/dropbox-oauth.js';
import { startOneDriveOAuth, ONEDRIVE_CLIENT_ID } from '../lib/onedrive-oauth.js';

// NEW:
import {
  startGoogleOAuth,
  revokeGoogleToken,
  startDropboxOAuth,
  revokeDropboxToken,
  DROPBOX_CLIENT_ID,
  startOneDriveOAuth,
  ONEDRIVE_CLIENT_ID,
} from '../lib/oauth/index.js';
```

- [ ] **Step 2: Update sync.ts import**

Replace line 9:

```typescript
// OLD:
import { getChromeGoogleAccessToken } from '../lib/google-oauth.js';

// NEW:
import { getChromeGoogleAccessToken } from '../lib/oauth/index.js';
```

- [ ] **Step 3: Delete old files**

```bash
rm apps/extension/src/lib/google-oauth.ts
rm apps/extension/src/lib/dropbox-oauth.ts
rm apps/extension/src/lib/onedrive-oauth.ts
```

- [ ] **Step 4: Run all extension tests**

Run: `cd /Users/davidneto/keykeykey && pnpm --filter @keykeykey/extension exec vitest run`
Expected: All tests PASS

- [ ] **Step 5: Build both targets**

Run: `cd /Users/davidneto/keykeykey && pnpm --filter @keykeykey/extension build`
Expected: Both Chrome and Firefox builds succeed

- [ ] **Step 6: Commit**

```bash
git add -A apps/extension/src/lib/ apps/extension/src/background/message-handler.ts apps/extension/src/background/sync.ts
git commit -m "refactor(extension): move OAuth files to lib/oauth/, update imports, delete old files"
```

---

### Task 4: Format and final verification

- [ ] **Step 1: Run Prettier**

Run: `cd /Users/davidneto/keykeykey && pnpm format`

- [ ] **Step 2: Run lint**

Run: `cd /Users/davidneto/keykeykey && pnpm --filter @keykeykey/extension lint`
Expected: No errors

- [ ] **Step 3: Run full test suite**

Run: `cd /Users/davidneto/keykeykey && pnpm --filter @keykeykey/extension exec vitest run`
Expected: All tests PASS

- [ ] **Step 4: Build both targets**

Run: `cd /Users/davidneto/keykeykey && pnpm --filter @keykeykey/extension build`
Expected: Both Chrome and Firefox builds succeed

- [ ] **Step 5: Commit if formatting changed anything**

```bash
git add -A apps/extension/
git commit -m "style(extension): fix formatting in oauth module"
```

- [ ] **Step 6: Run critical E2E tests**

Run: `cd /Users/davidneto/keykeykey/e2e && npx playwright test --grep @critical`
Expected: All critical tests pass
