# Dropbox & OneDrive Sync + iCloud Removal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove all iCloud sync references and add Dropbox and OneDrive as sync providers using a shared generic OAuth module.

**Architecture:** Refactor Google-specific OAuth code into a generic `oauth.ts` module. Build `DropboxAdapter` and `OneDriveAdapter` as thin `ISyncAdapter` implementations using REST APIs with the same `getAccessToken` callback pattern as `GoogleDriveAdapter`. Wire into all three apps (desktop, mobile, extension) with per-platform OAuth starters.

**Tech Stack:** TypeScript, Vitest, Tauri (Rust), Expo, Manifest V3 browser extension, OAuth2 PKCE, Dropbox API v2, Microsoft Graph API.

**Spec:** `docs/superpowers/specs/2026-03-27-dropbox-onedrive-sync-design.md`

---

## File Structure

### Files to delete

- `packages/core/src/sync/icloud-adapter.ts`
- `packages/core/src/sync/icloud-adapter.test.ts`

### Files to create (core)

- `packages/core/src/sync/oauth.ts` — generic OAuth2 PKCE module (extracted from google-oauth.ts)
- `packages/core/src/sync/oauth.test.ts` — tests for generic OAuth module
- `packages/core/src/sync/dropbox-adapter.ts` — Dropbox ISyncAdapter using API v2
- `packages/core/src/sync/dropbox-adapter.test.ts` — tests
- `packages/core/src/sync/dropbox-oauth.ts` — Dropbox OAuth constants + wrappers
- `packages/core/src/sync/dropbox-oauth.test.ts` — tests
- `packages/core/src/sync/onedrive-adapter.ts` — OneDrive ISyncAdapter using Graph API
- `packages/core/src/sync/onedrive-adapter.test.ts` — tests
- `packages/core/src/sync/onedrive-oauth.ts` — OneDrive OAuth constants + wrappers
- `packages/core/src/sync/onedrive-oauth.test.ts` — tests

### Files to create (apps)

- `apps/desktop/src/lib/dropbox-oauth.ts` — desktop Dropbox OAuth starter
- `apps/desktop/src/lib/onedrive-oauth.ts` — desktop OneDrive OAuth starter
- `apps/mobile/lib/dropbox-oauth.ts` — mobile Dropbox OAuth starter
- `apps/mobile/lib/onedrive-oauth.ts` — mobile OneDrive OAuth starter
- `apps/extension/src/lib/dropbox-oauth.ts` — extension Dropbox OAuth starter
- `apps/extension/src/lib/onedrive-oauth.ts` — extension OneDrive OAuth starter

### Files to modify (core)

- `packages/core/src/sync/google-oauth.ts` — slim down to thin wrapper over oauth.ts
- `packages/core/src/sync/google-oauth.test.ts` — update to test wrapper layer only (remove generic tests now in oauth.test.ts, keep only Google-specific wrapper tests)
- `packages/core/src/sync/sync-config.ts` — add dropbox/onedrive providers, remove icloud, remove `AdapterPlatformCallbacks`
- `packages/core/src/sync/sync-config.test.ts` — update tests
- `packages/core/src/sync/sync-lifecycle.ts` — remove `AdapterPlatformCallbacks` usage, remove `platformCallbacks` from constructor and all `createAdapterFromConfig()` calls
- `packages/core/src/sync/index.ts` — update exports (remove iCloud, remove `AdapterPlatformCallbacks`, add new providers)
- `packages/core/src/sync/types.ts` — update doc comment

### Files to modify (desktop)

- `apps/desktop/src-tauri/src/oauth_server.rs` — rename commands
- `apps/desktop/src-tauri/src/lib.rs` — update command registration
- `apps/desktop/src/lib/google-oauth.ts` — use renamed Tauri commands
- `apps/desktop/src/lib/vault-context.tsx` — remove `platformCallbacks: {}` from SyncLifecycle construction
- `apps/desktop/src/screens/SyncSettingsScreen.tsx` — remove iCloud, add Dropbox/OneDrive
- `apps/desktop/src/screens/RestoreScreen.tsx` — remove iCloud option
- `apps/desktop/src/screens/SettingsScreen.tsx` — remove iCloud status text
- `apps/desktop/src/screens/__tests__/SyncSettingsScreen.test.tsx` — update tests

### Files to modify (mobile)

- `apps/mobile/app/settings/sync.tsx` — remove iCloud, add Dropbox/OneDrive
- `apps/mobile/app/(tabs)/settings.tsx` — remove iCloud status text
- `apps/mobile/lib/vault-context.tsx` — remove `platformCallbacks: {}` from SyncLifecycle construction
- `apps/mobile/__tests__/screens/sync-settings.test.tsx` — update tests

### Files to modify (extension)

- `apps/extension/src/popup/screens/SyncSettingsScreen.tsx` — remove iCloud, add Dropbox/OneDrive
- `apps/extension/src/popup/screens/RestoreScreen.tsx` — remove iCloud option
- `apps/extension/src/popup/screens/SyncSettingsScreen.test.tsx` — update tests
- `apps/extension/src/lib/messages.ts` — add Dropbox/OneDrive OAuth message types
- `apps/extension/src/background/message-handler.ts` — handle new OAuth messages
- `apps/extension/src/background/sync.ts` — remove `platformCallbacks: {}` from SyncLifecycle construction

### Files to modify (docs)

- `implementationplan.md` — replace iCloud with Dropbox/OneDrive
- `CLAUDE.md` — update sync provider references

---

## Task 1: Remove iCloud adapter and references from core

**Files:**

- Delete: `packages/core/src/sync/icloud-adapter.ts`
- Delete: `packages/core/src/sync/icloud-adapter.test.ts`
- Modify: `packages/core/src/sync/sync-config.ts`
- Modify: `packages/core/src/sync/sync-config.test.ts`
- Modify: `packages/core/src/sync/index.ts`
- Modify: `packages/core/src/sync/types.ts`

- [ ] **Step 1: Delete iCloud adapter files**

```bash
rm packages/core/src/sync/icloud-adapter.ts packages/core/src/sync/icloud-adapter.test.ts
```

- [ ] **Step 2: Remove iCloud from `sync-config.ts`**

In `packages/core/src/sync/sync-config.ts`:

- Remove `import { ICloudAdapter } from './icloud-adapter.js';`
- Remove `import type { ICloudFs } from './icloud-adapter.js';`
- Remove `'icloud'` from the `SyncProvider` type and `SyncConfigSchema` enum
- Remove `icloud: z.object({ containerPath: z.string() }).optional()` from `SyncConfigSchema`
- Remove the `case 'icloud'` block from `createAdapterFromConfig()`
- Remove `icloudFs?: ICloudFs;` from `AdapterPlatformCallbacks`
- Remove `const APPLE_PLATFORMS = ['ios', 'macos', 'safari'];`
- Change `getAvailableProviders(platform: string)` to `getAvailableProviders()` — remove the platform parameter and the APPLE_PLATFORMS gating. Just return the static array:

```typescript
export function getAvailableProviders(): SyncProvider[] {
  return ['none', 'webdav', 'google-drive'];
}
```

(Dropbox/OneDrive will be added in a later task.)

- [ ] **Step 3: Remove iCloud from `index.ts`**

In `packages/core/src/sync/index.ts`, remove lines 44-45:

```typescript
export { ICloudAdapter } from './icloud-adapter.js';
export type { ICloudConfig, ICloudFs } from './icloud-adapter.js';
```

- [ ] **Step 4: Update doc comment in `types.ts`**

In `packages/core/src/sync/types.ts`, change line 4 from:

```
 * All sync adapters (local filesystem, iCloud, Google Drive, OneDrive, S3)
```

to:

```
 * All sync adapters (WebDAV, Google Drive, Dropbox, OneDrive)
```

- [ ] **Step 5: Update `sync-config.test.ts`**

Remove all iCloud test cases:

- Remove the `'icloud'` case in the adapter creation tests (missing config, missing callback, successful creation)
- Remove the `getAvailableProviders` platform-gating tests for iCloud
- Update all `getAvailableProviders()` calls to remove the platform argument

- [ ] **Step 6: Run tests to verify**

```bash
pnpm --filter @keykeykey/core test
```

Expected: All tests pass. No iCloud references remain in core.

- [ ] **Step 7: Commit**

```bash
git add -A packages/core/src/sync/
git commit -m "refactor(core): remove iCloud sync adapter and references"
```

---

## Task 2: Extract generic OAuth module

**Files:**

- Create: `packages/core/src/sync/oauth.ts`
- Create: `packages/core/src/sync/oauth.test.ts`
- Modify: `packages/core/src/sync/google-oauth.ts`
- Modify: `packages/core/src/sync/google-oauth.test.ts`
- Modify: `packages/core/src/sync/index.ts`

- [ ] **Step 1: Write `oauth.test.ts` — failing tests**

Create `packages/core/src/sync/oauth.test.ts`. Migrate the generic tests from `google-oauth.test.ts` — PKCE generation, code challenge, token exchange, refresh, caching, error handling — but import from `./oauth.js` and use generic function signatures (with `tokenEndpoint`/`authEndpoint` params instead of hardcoded Google URLs).

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  generateCodeVerifier,
  generateCodeChallenge,
  buildAuthUrl,
  exchangeAuthCode,
  refreshAccessToken,
  revokeToken,
  createCachedTokenProvider,
  OAuthError,
} from './oauth.js';

const TEST_ENDPOINTS = {
  authEndpoint: 'https://example.com/authorize',
  tokenEndpoint: 'https://example.com/token',
  revokeEndpoint: 'https://example.com/revoke',
};

describe('PKCE helpers', () => {
  it('generateCodeVerifier returns 64-char URL-safe string', () => {
    const verifier = generateCodeVerifier();
    expect(verifier).toHaveLength(64);
    expect(verifier).toMatch(/^[A-Za-z0-9\-._~]+$/);
  });

  it('generateCodeVerifier produces unique values', () => {
    const a = generateCodeVerifier();
    const b = generateCodeVerifier();
    expect(a).not.toBe(b);
  });

  it('generateCodeChallenge returns base64url-encoded SHA-256', async () => {
    const challenge = await generateCodeChallenge('test_verifier');
    expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/); // base64url, no padding
    expect(challenge.length).toBeGreaterThan(0);
  });
});

describe('buildAuthUrl', () => {
  it('builds URL with all required params', async () => {
    const url = await buildAuthUrl({
      endpoints: TEST_ENDPOINTS,
      clientId: 'client123',
      redirectUri: 'http://localhost:9999',
      codeVerifier: 'test_verifier',
      scope: 'files.read',
    });
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe('https://example.com/authorize');
    expect(parsed.searchParams.get('client_id')).toBe('client123');
    expect(parsed.searchParams.get('redirect_uri')).toBe('http://localhost:9999');
    expect(parsed.searchParams.get('response_type')).toBe('code');
    expect(parsed.searchParams.get('code_challenge_method')).toBe('S256');
    expect(parsed.searchParams.get('scope')).toBe('files.read');
  });

  it('includes extraParams when provided', async () => {
    const url = await buildAuthUrl({
      endpoints: TEST_ENDPOINTS,
      clientId: 'c',
      redirectUri: 'http://localhost',
      codeVerifier: 'v',
      extraParams: { token_access_type: 'offline', prompt: 'consent' },
    });
    const parsed = new URL(url);
    expect(parsed.searchParams.get('token_access_type')).toBe('offline');
    expect(parsed.searchParams.get('prompt')).toBe('consent');
  });

  it('includes state when provided', async () => {
    const url = await buildAuthUrl({
      endpoints: TEST_ENDPOINTS,
      clientId: 'c',
      redirectUri: 'http://localhost',
      codeVerifier: 'v',
      state: 'abc123',
    });
    const parsed = new URL(url);
    expect(parsed.searchParams.get('state')).toBe('abc123');
  });
});

describe('exchangeAuthCode', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('exchanges code for tokens', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            access_token: 'at',
            refresh_token: 'rt',
            expires_in: 3600,
          }),
      }),
    );

    const result = await exchangeAuthCode({
      tokenEndpoint: TEST_ENDPOINTS.tokenEndpoint,
      code: 'auth_code',
      clientId: 'client123',
      redirectUri: 'http://localhost',
      codeVerifier: 'verifier',
    });

    expect(result.accessToken).toBe('at');
    expect(result.refreshToken).toBe('rt');
    expect(result.expiresIn).toBe(3600);

    const fetchCall = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(fetchCall[0]).toBe(TEST_ENDPOINTS.tokenEndpoint);
    const body = fetchCall[1].body;
    expect(body).toContain('grant_type=authorization_code');
    expect(body).toContain('code=auth_code');
    expect(body).toContain('code_verifier=verifier');
  });

  it('includes clientSecret when provided', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            access_token: 'at',
            refresh_token: 'rt',
            expires_in: 3600,
          }),
      }),
    );

    await exchangeAuthCode({
      tokenEndpoint: TEST_ENDPOINTS.tokenEndpoint,
      code: 'c',
      clientId: 'id',
      redirectUri: 'http://localhost',
      codeVerifier: 'v',
      clientSecret: 'secret',
    });

    const body = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body;
    expect(body).toContain('client_secret=secret');
  });

  it('throws OAuthError on failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        json: () => Promise.resolve({ error: 'invalid_grant', error_description: 'Bad code' }),
      }),
    );

    await expect(
      exchangeAuthCode({
        tokenEndpoint: TEST_ENDPOINTS.tokenEndpoint,
        code: 'bad',
        clientId: 'id',
        redirectUri: 'http://localhost',
        codeVerifier: 'v',
      }),
    ).rejects.toThrow(OAuthError);
  });
});

describe('refreshAccessToken', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('refreshes token', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ access_token: 'new_at', expires_in: 3600 }),
      }),
    );

    const result = await refreshAccessToken({
      tokenEndpoint: TEST_ENDPOINTS.tokenEndpoint,
      refreshToken: 'rt',
      clientId: 'id',
    });

    expect(result.accessToken).toBe('new_at');
  });

  it('throws SyncAuthError on invalid_grant', async () => {
    const { SyncAuthError } = await import('./errors.js');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        json: () => Promise.resolve({ error: 'invalid_grant', error_description: 'Revoked' }),
      }),
    );

    await expect(
      refreshAccessToken({
        tokenEndpoint: TEST_ENDPOINTS.tokenEndpoint,
        refreshToken: 'bad',
        clientId: 'id',
      }),
    ).rejects.toThrow(SyncAuthError);
  });
});

describe('revokeToken', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('revokes token via body (default)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
    await revokeToken('https://example.com/revoke', 'mytoken');
    const call = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[1].body).toContain('token=mytoken');
  });

  it('revokes token via bearer header', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
    await revokeToken('https://example.com/revoke', 'mytoken', 'bearer');
    const call = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[1].headers.Authorization).toBe('Bearer mytoken');
  });

  it('never throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')));
    await expect(revokeToken('https://x.com/r', 't')).resolves.toBeUndefined();
  });
});

describe('createCachedTokenProvider', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useFakeTimers();
  });

  it('caches token and refreshes before expiry', async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ access_token: 'token1', expires_in: 120 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ access_token: 'token2', expires_in: 120 }),
      });
    vi.stubGlobal('fetch', mockFetch);

    const getToken = createCachedTokenProvider(TEST_ENDPOINTS.tokenEndpoint, 'rt', 'id');

    const t1 = await getToken();
    expect(t1).toBe('token1');
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Within cache window — should reuse
    const t2 = await getToken();
    expect(t2).toBe('token1');
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Advance past expiry buffer (120s - 60s buffer = 60s)
    vi.advanceTimersByTime(61_000);
    const t3 = await getToken();
    expect(t3).toBe('token2');
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  afterEach(() => {
    vi.useRealTimers();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @keykeykey/core test -- oauth.test.ts
```

Expected: FAIL — `./oauth.js` does not exist.

- [ ] **Step 3: Write `oauth.ts` — generic OAuth2 PKCE module**

Create `packages/core/src/sync/oauth.ts`:

```typescript
/**
 * Generic OAuth 2.0 helpers with PKCE support.
 *
 * Provider-specific modules (google-oauth, dropbox-oauth, onedrive-oauth)
 * wrap these with their endpoint constants.
 *
 * @module sync/oauth
 */

import { SyncAuthError } from './errors.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OAuthEndpoints {
  authEndpoint: string;
  tokenEndpoint: string;
  revokeEndpoint?: string;
}

export interface BuildAuthUrlParams {
  endpoints: OAuthEndpoints;
  clientId: string;
  redirectUri: string;
  codeVerifier: string;
  scope?: string;
  state?: string;
  extraParams?: Record<string, string>;
}

export interface ExchangeAuthCodeParams {
  tokenEndpoint: string;
  code: string;
  clientId: string;
  redirectUri: string;
  codeVerifier: string;
  clientSecret?: string;
}

export interface TokenResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface RefreshParams {
  tokenEndpoint: string;
  refreshToken: string;
  clientId: string;
  clientSecret?: string;
}

export interface RefreshResponse {
  accessToken: string;
  expiresIn: number;
}

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

/** Thrown when an OAuth request fails. */
export class OAuthError extends Error {
  readonly error: string;
  readonly errorDescription: string;

  constructor(error: string, errorDescription: string) {
    super(`OAuth error: ${error} — ${errorDescription}`);
    this.name = 'OAuthError';
    this.error = error;
    this.errorDescription = errorDescription;
  }
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// ---------------------------------------------------------------------------
// PKCE helpers (RFC 7636)
// ---------------------------------------------------------------------------

const UNRESERVED = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';

/** Generate a 64-character URL-safe random string for PKCE. */
export function generateCodeVerifier(): string {
  const length = 64;
  const alphabetLen = UNRESERVED.length; // 66
  const maxUnbiased = 256 - (256 % alphabetLen); // 198
  const result: string[] = [];
  while (result.length < length) {
    const bytes = crypto.getRandomValues(new Uint8Array(length * 2));
    for (const b of bytes) {
      if (b < maxUnbiased && result.length < length) {
        result.push(UNRESERVED[b % alphabetLen]!);
      }
    }
  }
  return result.join('');
}

/** Compute the S256 code challenge for a PKCE verifier. */
export async function generateCodeChallenge(verifier: string): Promise<string> {
  const data = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return base64UrlEncode(new Uint8Array(digest));
}

// ---------------------------------------------------------------------------
// Auth URL
// ---------------------------------------------------------------------------

/** Build an OAuth 2.0 authorization URL with PKCE. */
export async function buildAuthUrl(params: BuildAuthUrlParams): Promise<string> {
  const challenge = await generateCodeChallenge(params.codeVerifier);
  const url = new URL(params.endpoints.authEndpoint);
  url.searchParams.set('client_id', params.clientId);
  url.searchParams.set('redirect_uri', params.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('code_challenge', challenge);

  if (params.scope) {
    url.searchParams.set('scope', params.scope);
  }
  if (params.state) {
    url.searchParams.set('state', params.state);
  }
  if (params.extraParams) {
    for (const [key, value] of Object.entries(params.extraParams)) {
      url.searchParams.set(key, value);
    }
  }

  return url.toString();
}

// ---------------------------------------------------------------------------
// Token exchange
// ---------------------------------------------------------------------------

/** Exchange an authorization code for tokens. */
export async function exchangeAuthCode(params: ExchangeAuthCodeParams): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: params.code,
    client_id: params.clientId,
    redirect_uri: params.redirectUri,
    code_verifier: params.codeVerifier,
  });
  if (params.clientSecret) body.set('client_secret', params.clientSecret);

  const res = await fetch(params.tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  const json = (await res.json()) as Record<string, unknown>;

  if (!res.ok) {
    throw new OAuthError(
      (json.error as string) ?? 'unknown_error',
      (json.error_description as string) ?? 'Token exchange failed',
    );
  }

  return {
    accessToken: json.access_token as string,
    refreshToken: json.refresh_token as string,
    expiresIn: json.expires_in as number,
  };
}

// ---------------------------------------------------------------------------
// Token refresh
// ---------------------------------------------------------------------------

/** Refresh an access token. Throws SyncAuthError on invalid_grant. */
export async function refreshAccessToken(params: RefreshParams): Promise<RefreshResponse> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: params.refreshToken,
    client_id: params.clientId,
  });
  if (params.clientSecret) body.set('client_secret', params.clientSecret);

  const res = await fetch(params.tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  const json = (await res.json()) as Record<string, unknown>;

  if (!res.ok) {
    if (json.error === 'invalid_grant') {
      throw new SyncAuthError(
        (json.error_description as string) ?? 'Refresh token is invalid or revoked',
      );
    }
    throw new OAuthError(
      (json.error as string) ?? 'unknown_error',
      (json.error_description as string) ?? 'Token refresh failed',
    );
  }

  return {
    accessToken: json.access_token as string,
    expiresIn: json.expires_in as number,
  };
}

// ---------------------------------------------------------------------------
// Token revocation
// ---------------------------------------------------------------------------

/**
 * Revoke a token. Best-effort — never throws.
 *
 * @param revokeEndpoint - The provider's revocation URL
 * @param token - The token to revoke
 * @param style - 'body' (default): send token as form body (Google).
 *                'bearer': send as Authorization header with empty body (Dropbox).
 */
export async function revokeToken(
  revokeEndpoint: string,
  token: string,
  style: 'body' | 'bearer' = 'body',
): Promise<void> {
  try {
    if (style === 'bearer') {
      await fetch(revokeEndpoint, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
    } else {
      await fetch(revokeEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token }).toString(),
      });
    }
  } catch {
    // Best-effort — ignore errors
  }
}

// ---------------------------------------------------------------------------
// Cached token provider
// ---------------------------------------------------------------------------

/**
 * Create a function that returns a valid access token, caching and refreshing
 * automatically. Refreshes 60 seconds before expiry.
 */
export function createCachedTokenProvider(
  tokenEndpoint: string,
  refreshToken: string,
  clientId: string,
  clientSecret?: string,
): () => Promise<string> {
  let cachedToken: string | null = null;
  let expiresAt = 0;

  return async () => {
    const now = Date.now();
    const bufferMs = 60_000;

    if (cachedToken && now < expiresAt - bufferMs) {
      return cachedToken;
    }

    const result = await refreshAccessToken({
      tokenEndpoint,
      refreshToken,
      clientId,
      clientSecret,
    });
    cachedToken = result.accessToken;
    expiresAt = now + result.expiresIn * 1000;
    return cachedToken;
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm --filter @keykeykey/core test -- oauth.test.ts
```

Expected: All tests pass.

- [ ] **Step 5: Slim down `google-oauth.ts` to wrapper**

Refactor `packages/core/src/sync/google-oauth.ts` to import from `./oauth.js` and re-export with Google-specific constants. Preserve the existing function signatures so no call sites break:

```typescript
/**
 * Google OAuth 2.0 helpers — thin wrapper over generic oauth.ts.
 *
 * @module sync/google-oauth
 */

import {
  OAuthError,
  generateCodeVerifier,
  generateCodeChallenge,
  buildAuthUrl as genericBuildAuthUrl,
  exchangeAuthCode as genericExchangeAuthCode,
  refreshAccessToken as genericRefreshAccessToken,
  revokeToken as genericRevokeToken,
  createCachedTokenProvider as genericCreateCachedTokenProvider,
} from './oauth.js';
import type { OAuthEndpoints, TokenResponse, RefreshResponse } from './oauth.js';

// Re-export generic pieces consumers may need
export { generateCodeVerifier, generateCodeChallenge };
export type { TokenResponse, RefreshResponse };

// ---------------------------------------------------------------------------
// Google-specific constants
// ---------------------------------------------------------------------------

export const GOOGLE_ENDPOINTS: OAuthEndpoints = {
  authEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenEndpoint: 'https://oauth2.googleapis.com/token',
  revokeEndpoint: 'https://oauth2.googleapis.com/revoke',
};

const GOOGLE_DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';

// ---------------------------------------------------------------------------
// Backwards-compatible re-exports
// ---------------------------------------------------------------------------

/** @deprecated Use OAuthError from oauth.ts */
export { OAuthError as GoogleOAuthError };

export interface BuildAuthUrlParams {
  clientId: string;
  redirectUri: string;
  codeVerifier: string;
  scope?: string;
  loginHint?: string;
  state?: string;
}

export interface ExchangeAuthCodeParams {
  code: string;
  clientId: string;
  redirectUri: string;
  codeVerifier: string;
  clientSecret?: string;
}

export interface RefreshParams {
  refreshToken: string;
  clientId: string;
  clientSecret?: string;
}

export async function buildAuthUrl(params: BuildAuthUrlParams): Promise<string> {
  return genericBuildAuthUrl({
    endpoints: GOOGLE_ENDPOINTS,
    clientId: params.clientId,
    redirectUri: params.redirectUri,
    codeVerifier: params.codeVerifier,
    scope: params.scope ?? GOOGLE_DRIVE_SCOPE,
    state: params.state,
    extraParams: {
      access_type: 'offline',
      prompt: 'consent',
      ...(params.loginHint ? { login_hint: params.loginHint } : {}),
    },
  });
}

export async function exchangeAuthCode(params: ExchangeAuthCodeParams): Promise<TokenResponse> {
  return genericExchangeAuthCode({
    tokenEndpoint: GOOGLE_ENDPOINTS.tokenEndpoint,
    code: params.code,
    clientId: params.clientId,
    redirectUri: params.redirectUri,
    codeVerifier: params.codeVerifier,
    clientSecret: params.clientSecret,
  });
}

export async function refreshAccessToken(params: RefreshParams): Promise<RefreshResponse> {
  return genericRefreshAccessToken({
    tokenEndpoint: GOOGLE_ENDPOINTS.tokenEndpoint,
    refreshToken: params.refreshToken,
    clientId: params.clientId,
    clientSecret: params.clientSecret,
  });
}

export async function revokeToken(token: string): Promise<void> {
  return genericRevokeToken(GOOGLE_ENDPOINTS.revokeEndpoint!, token, 'body');
}

export function createCachedTokenProvider(
  refreshToken: string,
  clientId: string,
  clientSecret?: string,
): () => Promise<string> {
  return genericCreateCachedTokenProvider(
    GOOGLE_ENDPOINTS.tokenEndpoint,
    refreshToken,
    clientId,
    clientSecret,
  );
}
```

- [ ] **Step 6: Update `google-oauth.test.ts`**

Update tests to verify:

- The wrapper functions delegate to `oauth.ts` with correct Google endpoints
- `GoogleOAuthError` is `OAuthError` (backward compat)
- `buildAuthUrl` includes `access_type=offline` and `prompt=consent`
- Existing test assertions still hold (function signatures unchanged)

- [ ] **Step 7: Update `index.ts` exports**

Add generic OAuth exports to `packages/core/src/sync/index.ts`:

```typescript
// Generic OAuth (new)
export { OAuthError } from './oauth.js';
export type { OAuthEndpoints } from './oauth.js';
```

The existing google-oauth re-exports stay as-is for backward compat.

- [ ] **Step 8: Run all core tests**

```bash
pnpm --filter @keykeykey/core test
```

Expected: All tests pass. Google OAuth tests still pass with the wrapper.

- [ ] **Step 9: Commit**

```bash
git add packages/core/src/sync/oauth.ts packages/core/src/sync/oauth.test.ts packages/core/src/sync/google-oauth.ts packages/core/src/sync/google-oauth.test.ts packages/core/src/sync/index.ts
git commit -m "refactor(core): extract generic OAuth module from google-oauth"
```

---

## Task 3: Implement Dropbox adapter

**Files:**

- Create: `packages/core/src/sync/dropbox-adapter.ts`
- Create: `packages/core/src/sync/dropbox-adapter.test.ts`
- Create: `packages/core/src/sync/dropbox-oauth.ts`
- Create: `packages/core/src/sync/dropbox-oauth.test.ts`

- [ ] **Step 1: Write `dropbox-adapter.test.ts` — failing tests**

Create `packages/core/src/sync/dropbox-adapter.test.ts`. Follow the same pattern as `google-drive-adapter.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DropboxAdapter } from './dropbox-adapter.js';

const mockGetAccessToken = vi.fn().mockResolvedValue('test-token');

function createAdapter() {
  return new DropboxAdapter({ getAccessToken: mockGetAccessToken });
}

describe('DropboxAdapter', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockGetAccessToken.mockResolvedValue('test-token');
  });

  describe('readVaultBlob', () => {
    it('returns bytes when file exists', async () => {
      const data = new Uint8Array([1, 2, 3]);
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          arrayBuffer: () => Promise.resolve(data.buffer),
        }),
      );

      const result = await createAdapter().readVaultBlob();
      expect(result).toEqual(data);

      const call = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(call[0]).toBe('https://content.dropboxapi.com/2/files/download');
      const apiArg = JSON.parse(call[1].headers['Dropbox-API-Arg']);
      expect(apiArg.path).toBe('/vault.enc');
    });

    it('returns null when file not found (409 path/not_found)', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: false,
          status: 409,
          json: () => Promise.resolve({ error: { '.tag': 'path', path: { '.tag': 'not_found' } } }),
        }),
      );

      const result = await createAdapter().readVaultBlob();
      expect(result).toBeNull();
    });

    it('throws SyncAuthError on 401', async () => {
      const { SyncAuthError } = await import('./errors.js');
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: false,
          status: 401,
          json: () => Promise.resolve({}),
        }),
      );

      await expect(createAdapter().readVaultBlob()).rejects.toThrow(SyncAuthError);
    });
  });

  describe('writeVaultBlob', () => {
    it('uploads with overwrite mode', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }));
      const data = new Uint8Array([4, 5, 6]);
      await createAdapter().writeVaultBlob(data);

      const call = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(call[0]).toBe('https://content.dropboxapi.com/2/files/upload');
      const apiArg = JSON.parse(call[1].headers['Dropbox-API-Arg']);
      expect(apiArg.path).toBe('/vault.enc');
      expect(apiArg.mode).toBe('overwrite');
      expect(call[1].body).toBe(data);
    });
  });

  describe('readItem / writeItem / deleteItem', () => {
    it('readItem downloads from /items/{id}.bin', async () => {
      const data = new Uint8Array([7, 8]);
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          arrayBuffer: () => Promise.resolve(data.buffer),
        }),
      );

      const result = await createAdapter().readItem('abc');
      expect(result).toEqual(data);
      const apiArg = JSON.parse(
        (fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].headers['Dropbox-API-Arg'],
      );
      expect(apiArg.path).toBe('/items/abc.bin');
    });

    it('writeItem uploads to /items/{id}.bin', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }));
      await createAdapter().writeItem('abc', new Uint8Array([9]));
      const apiArg = JSON.parse(
        (fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].headers['Dropbox-API-Arg'],
      );
      expect(apiArg.path).toBe('/items/abc.bin');
    });

    it('deleteItem sends delete request', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve({}) }),
      );
      await createAdapter().deleteItem('abc');
      const call = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(call[0]).toBe('https://api.dropboxapi.com/2/files/delete_v2');
      const body = JSON.parse(call[1].body);
      expect(body.path).toBe('/items/abc.bin');
    });

    it('deleteItem ignores path_lookup/not_found errors', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: false,
          status: 409,
          json: () =>
            Promise.resolve({
              error: { '.tag': 'path_lookup', path_lookup: { '.tag': 'not_found' } },
            }),
        }),
      );
      await expect(createAdapter().deleteItem('gone')).resolves.toBeUndefined();
    });
  });

  describe('listItems', () => {
    it('returns item IDs from list_folder response', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              entries: [
                { name: 'abc.bin', '.tag': 'file' },
                { name: 'def.bin', '.tag': 'file' },
              ],
              has_more: false,
            }),
        }),
      );

      const items = await createAdapter().listItems();
      expect(items).toEqual(['abc', 'def']);
    });

    it('handles pagination with list_folder/continue', async () => {
      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              entries: [{ name: 'a.bin', '.tag': 'file' }],
              has_more: true,
              cursor: 'cursor1',
            }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              entries: [{ name: 'b.bin', '.tag': 'file' }],
              has_more: false,
            }),
        });
      vi.stubGlobal('fetch', mockFetch);

      const items = await createAdapter().listItems();
      expect(items).toEqual(['a', 'b']);
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(mockFetch.mock.calls[1][0]).toBe(
        'https://api.dropboxapi.com/2/files/list_folder/continue',
      );
    });

    it('returns empty array when folder not found', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: false,
          status: 409,
          json: () => Promise.resolve({ error: { '.tag': 'path', path: { '.tag': 'not_found' } } }),
        }),
      );

      const items = await createAdapter().listItems();
      expect(items).toEqual([]);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @keykeykey/core test -- dropbox-adapter.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write `dropbox-adapter.ts`**

Create `packages/core/src/sync/dropbox-adapter.ts`:

```typescript
/**
 * Dropbox sync adapter.
 *
 * Stores vault files in the app-scoped folder (Apps/KeyKeyKey/) using
 * Dropbox API v2. Auth is delegated to a getAccessToken callback.
 *
 * File layout:
 *   /vault.enc            — encrypted vault blob
 *   /items/{id}.bin       — encrypted vault items
 */

import type { ISyncAdapter, SyncManifest } from './types.js';
import { SyncAuthError } from './errors.js';

const CONTENT_API = 'https://content.dropboxapi.com/2/files';
const API = 'https://api.dropboxapi.com/2/files';

export interface DropboxAdapterOptions {
  getAccessToken: () => Promise<string>;
}

export class DropboxAdapter implements ISyncAdapter {
  private readonly getAccessToken: () => Promise<string>;

  constructor(options: DropboxAdapterOptions) {
    this.getAccessToken = options.getAccessToken;
  }

  async readVaultBlob(): Promise<Uint8Array | null> {
    return this.downloadFile('/vault.enc');
  }

  async writeVaultBlob(data: Uint8Array): Promise<void> {
    await this.uploadFile('/vault.enc', data);
  }

  // No readLegacyManifest/deleteLegacyManifest — new provider, no legacy data.

  async readItem(id: string): Promise<Uint8Array | null> {
    return this.downloadFile(`/items/${id}.bin`);
  }

  async writeItem(id: string, data: Uint8Array): Promise<void> {
    await this.uploadFile(`/items/${id}.bin`, data);
  }

  async deleteItem(id: string): Promise<void> {
    await this.deleteFile(`/items/${id}.bin`);
  }

  async listItems(): Promise<string[]> {
    const token = await this.getAccessToken();
    const entries: Array<{ name: string }> = [];

    let res = await fetch(`${API}/list_folder`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ path: '/items' }),
    });

    if (!res.ok) {
      this.checkAuth(res);
      // Folder not found — no items yet
      if (res.status === 409) return [];
      return [];
    }

    let body = (await res.json()) as {
      entries: Array<{ name: string; '.tag': string }>;
      has_more: boolean;
      cursor?: string;
    };
    entries.push(...body.entries);

    while (body.has_more && body.cursor) {
      res = await fetch(`${API}/list_folder/continue`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ cursor: body.cursor }),
      });
      this.checkAuth(res);
      body = (await res.json()) as typeof body;
      entries.push(...body.entries);
    }

    return entries.filter((e) => e.name.endsWith('.bin')).map((e) => e.name.slice(0, -4));
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private async downloadFile(path: string): Promise<Uint8Array | null> {
    const token = await this.getAccessToken();
    const res = await fetch(`${CONTENT_API}/download`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Dropbox-API-Arg': JSON.stringify({ path }),
      },
    });

    if (!res.ok) {
      this.checkAuth(res);
      // 409 with path/not_found means file doesn't exist
      if (res.status === 409) return null;
      throw new Error(`Dropbox download failed (HTTP ${res.status})`);
    }

    return new Uint8Array(await res.arrayBuffer());
  }

  private async uploadFile(path: string, data: Uint8Array): Promise<void> {
    const token = await this.getAccessToken();
    const res = await fetch(`${CONTENT_API}/upload`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/octet-stream',
        'Dropbox-API-Arg': JSON.stringify({
          path,
          mode: 'overwrite',
          autorename: false,
          mute: true,
        }),
      },
      body: data as BodyInit,
    });

    this.checkAuth(res);
    if (!res.ok) {
      throw new Error(`Dropbox upload failed (HTTP ${res.status})`);
    }
  }

  private async deleteFile(path: string): Promise<void> {
    const token = await this.getAccessToken();
    const res = await fetch(`${API}/delete_v2`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ path }),
    });

    if (!res.ok) {
      this.checkAuth(res);
      // Ignore not_found on delete
      if (res.status === 409) return;
      throw new Error(`Dropbox delete failed (HTTP ${res.status})`);
    }
  }

  private checkAuth(res: { status: number }): void {
    if (res.status === 401) {
      throw new SyncAuthError('Dropbox auth failed (HTTP 401)');
    }
  }
}
```

- [ ] **Step 4: Run adapter tests**

```bash
pnpm --filter @keykeykey/core test -- dropbox-adapter.test.ts
```

Expected: All tests pass.

- [ ] **Step 5: Write `dropbox-oauth.test.ts` — failing tests**

Create `packages/core/src/sync/dropbox-oauth.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import {
  DROPBOX_ENDPOINTS,
  buildDropboxAuthUrl,
  exchangeDropboxAuthCode,
  createDropboxTokenProvider,
  revokeDropboxToken,
} from './dropbox-oauth.js';

describe('dropbox-oauth', () => {
  it('has correct endpoints', () => {
    expect(DROPBOX_ENDPOINTS.authEndpoint).toBe('https://www.dropbox.com/oauth2/authorize');
    expect(DROPBOX_ENDPOINTS.tokenEndpoint).toBe('https://api.dropboxapi.com/oauth2/token');
    expect(DROPBOX_ENDPOINTS.revokeEndpoint).toBe('https://api.dropboxapi.com/2/auth/token/revoke');
  });

  it('buildDropboxAuthUrl includes token_access_type=offline', async () => {
    const url = await buildDropboxAuthUrl({
      clientId: 'test',
      redirectUri: 'http://localhost',
      codeVerifier: 'v',
    });
    const parsed = new URL(url);
    expect(parsed.searchParams.get('token_access_type')).toBe('offline');
    expect(parsed.origin + parsed.pathname).toBe('https://www.dropbox.com/oauth2/authorize');
  });

  it('revokeDropboxToken uses bearer style', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
    await revokeDropboxToken('mytoken');
    const call = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[1].headers.Authorization).toBe('Bearer mytoken');
    vi.restoreAllMocks();
  });
});
```

- [ ] **Step 6: Write `dropbox-oauth.ts`**

Create `packages/core/src/sync/dropbox-oauth.ts`:

```typescript
/**
 * Dropbox OAuth 2.0 helpers — thin wrapper over generic oauth.ts.
 *
 * @module sync/dropbox-oauth
 */

import { buildAuthUrl, exchangeAuthCode, createCachedTokenProvider, revokeToken } from './oauth.js';
import type { OAuthEndpoints, ExchangeAuthCodeParams, TokenResponse } from './oauth.js';

export { generateCodeVerifier } from './oauth.js';

export const DROPBOX_ENDPOINTS: OAuthEndpoints = {
  authEndpoint: 'https://www.dropbox.com/oauth2/authorize',
  tokenEndpoint: 'https://api.dropboxapi.com/oauth2/token',
  revokeEndpoint: 'https://api.dropboxapi.com/2/auth/token/revoke',
};

export async function buildDropboxAuthUrl(params: {
  clientId: string;
  redirectUri: string;
  codeVerifier: string;
  state?: string;
}): Promise<string> {
  return buildAuthUrl({
    endpoints: DROPBOX_ENDPOINTS,
    clientId: params.clientId,
    redirectUri: params.redirectUri,
    codeVerifier: params.codeVerifier,
    state: params.state,
    extraParams: { token_access_type: 'offline' },
  });
}

export async function exchangeDropboxAuthCode(params: {
  code: string;
  clientId: string;
  redirectUri: string;
  codeVerifier: string;
}): Promise<TokenResponse> {
  return exchangeAuthCode({
    tokenEndpoint: DROPBOX_ENDPOINTS.tokenEndpoint,
    ...params,
  });
}

export function createDropboxTokenProvider(
  refreshToken: string,
  clientId: string,
): () => Promise<string> {
  return createCachedTokenProvider(DROPBOX_ENDPOINTS.tokenEndpoint, refreshToken, clientId);
}

export async function revokeDropboxToken(token: string): Promise<void> {
  return revokeToken(DROPBOX_ENDPOINTS.revokeEndpoint!, token, 'bearer');
}
```

- [ ] **Step 7: Run all Dropbox tests**

```bash
pnpm --filter @keykeykey/core test -- dropbox
```

Expected: All tests pass.

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/sync/dropbox-adapter.ts packages/core/src/sync/dropbox-adapter.test.ts packages/core/src/sync/dropbox-oauth.ts packages/core/src/sync/dropbox-oauth.test.ts
git commit -m "feat(core): add Dropbox sync adapter with OAuth"
```

---

## Task 4: Implement OneDrive adapter

**Files:**

- Create: `packages/core/src/sync/onedrive-adapter.ts`
- Create: `packages/core/src/sync/onedrive-adapter.test.ts`
- Create: `packages/core/src/sync/onedrive-oauth.ts`
- Create: `packages/core/src/sync/onedrive-oauth.test.ts`

- [ ] **Step 1: Write `onedrive-adapter.test.ts` — failing tests**

Create `packages/core/src/sync/onedrive-adapter.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OneDriveAdapter } from './onedrive-adapter.js';

const GRAPH = 'https://graph.microsoft.com/v1.0/me/drive/special/approot:';
const mockGetAccessToken = vi.fn().mockResolvedValue('test-token');

function createAdapter() {
  return new OneDriveAdapter({ getAccessToken: mockGetAccessToken });
}

describe('OneDriveAdapter', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockGetAccessToken.mockResolvedValue('test-token');
  });

  describe('readVaultBlob', () => {
    it('returns bytes when file exists', async () => {
      const data = new Uint8Array([1, 2, 3]);
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          arrayBuffer: () => Promise.resolve(data.buffer),
        }),
      );

      const result = await createAdapter().readVaultBlob();
      expect(result).toEqual(data);

      const call = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(call[0]).toBe(`${GRAPH}/vault.enc:/content`);
      expect(call[1].headers.Authorization).toBe('Bearer test-token');
    });

    it('returns null on 404', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: false,
          status: 404,
        }),
      );
      expect(await createAdapter().readVaultBlob()).toBeNull();
    });

    it('throws SyncAuthError on 401', async () => {
      const { SyncAuthError } = await import('./errors.js');
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: false,
          status: 401,
        }),
      );
      await expect(createAdapter().readVaultBlob()).rejects.toThrow(SyncAuthError);
    });
  });

  describe('writeVaultBlob', () => {
    it('PUTs binary content', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }));
      const data = new Uint8Array([4, 5, 6]);
      await createAdapter().writeVaultBlob(data);

      const call = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(call[0]).toBe(`${GRAPH}/vault.enc:/content`);
      expect(call[1].method).toBe('PUT');
      expect(call[1].headers['Content-Type']).toBe('application/octet-stream');
      expect(call[1].body).toBe(data);
    });
  });

  describe('readItem / writeItem / deleteItem', () => {
    it('readItem downloads from /items/{id}.bin', async () => {
      const data = new Uint8Array([7]);
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          arrayBuffer: () => Promise.resolve(data.buffer),
        }),
      );
      const result = await createAdapter().readItem('xyz');
      expect(result).toEqual(data);
      expect((fetch as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe(
        `${GRAPH}/items/xyz.bin:/content`,
      );
    });

    it('writeItem PUTs to /items/{id}.bin', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }));
      await createAdapter().writeItem('xyz', new Uint8Array([8]));
      expect((fetch as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe(
        `${GRAPH}/items/xyz.bin:/content`,
      );
    });

    it('deleteItem sends DELETE', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 204 }));
      await createAdapter().deleteItem('xyz');
      const call = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(call[0]).toBe(`${GRAPH}/items/xyz.bin:`);
      expect(call[1].method).toBe('DELETE');
    });

    it('deleteItem ignores 404', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));
      await expect(createAdapter().deleteItem('gone')).resolves.toBeUndefined();
    });
  });

  describe('listItems', () => {
    it('returns item IDs from children response', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              value: [{ name: 'abc.bin' }, { name: 'def.bin' }],
            }),
        }),
      );

      const items = await createAdapter().listItems();
      expect(items).toEqual(['abc', 'def']);
    });

    it('handles pagination with @odata.nextLink', async () => {
      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              value: [{ name: 'a.bin' }],
              '@odata.nextLink': 'https://graph.microsoft.com/v1.0/next-page',
            }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              value: [{ name: 'b.bin' }],
            }),
        });
      vi.stubGlobal('fetch', mockFetch);

      const items = await createAdapter().listItems();
      expect(items).toEqual(['a', 'b']);
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(mockFetch.mock.calls[1][0]).toBe('https://graph.microsoft.com/v1.0/next-page');
    });

    it('returns empty array when folder not found', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: false,
          status: 404,
        }),
      );
      expect(await createAdapter().listItems()).toEqual([]);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @keykeykey/core test -- onedrive-adapter.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write `onedrive-adapter.ts`**

Create `packages/core/src/sync/onedrive-adapter.ts`:

```typescript
/**
 * OneDrive sync adapter.
 *
 * Stores vault files in the hidden `approot` special folder using
 * Microsoft Graph API v1.0. Auth is delegated to a getAccessToken callback.
 *
 * File layout:
 *   approot:/vault.enc            — encrypted vault blob
 *   approot:/items/{id}.bin       — encrypted vault items
 */

import type { ISyncAdapter, SyncManifest } from './types.js';
import { SyncAuthError } from './errors.js';

const GRAPH_APPROOT = 'https://graph.microsoft.com/v1.0/me/drive/special/approot:';

export interface OneDriveAdapterOptions {
  getAccessToken: () => Promise<string>;
}

export class OneDriveAdapter implements ISyncAdapter {
  private readonly getAccessToken: () => Promise<string>;

  constructor(options: OneDriveAdapterOptions) {
    this.getAccessToken = options.getAccessToken;
  }

  async readVaultBlob(): Promise<Uint8Array | null> {
    return this.downloadFile('/vault.enc');
  }

  async writeVaultBlob(data: Uint8Array): Promise<void> {
    await this.uploadFile('/vault.enc', data);
  }

  // No readLegacyManifest/deleteLegacyManifest — new provider, no legacy data.

  async readItem(id: string): Promise<Uint8Array | null> {
    return this.downloadFile(`/items/${id}.bin`);
  }

  async writeItem(id: string, data: Uint8Array): Promise<void> {
    await this.uploadFile(`/items/${id}.bin`, data);
  }

  async deleteItem(id: string): Promise<void> {
    await this.deleteFile(`/items/${id}.bin`);
  }

  async listItems(): Promise<string[]> {
    const token = await this.getAccessToken();
    const entries: Array<{ name: string }> = [];

    let url: string | null = `${GRAPH_APPROOT}/items:/children`;

    while (url) {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) {
        this.checkAuth(res);
        if (res.status === 404) return [];
        throw new Error(`OneDrive list failed (HTTP ${res.status})`);
      }

      const body = (await res.json()) as {
        value: Array<{ name: string }>;
        '@odata.nextLink'?: string;
      };
      entries.push(...body.value);
      url = body['@odata.nextLink'] ?? null;
    }

    return entries.filter((e) => e.name.endsWith('.bin')).map((e) => e.name.slice(0, -4));
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private async downloadFile(path: string): Promise<Uint8Array | null> {
    const token = await this.getAccessToken();
    const res = await fetch(`${GRAPH_APPROOT}${path}:/content`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      this.checkAuth(res);
      if (res.status === 404) return null;
      throw new Error(`OneDrive download failed (HTTP ${res.status})`);
    }

    return new Uint8Array(await res.arrayBuffer());
  }

  private async uploadFile(path: string, data: Uint8Array): Promise<void> {
    const token = await this.getAccessToken();
    const res = await fetch(`${GRAPH_APPROOT}${path}:/content`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/octet-stream',
      },
      body: data as BodyInit,
    });

    this.checkAuth(res);
    if (!res.ok) {
      throw new Error(`OneDrive upload failed (HTTP ${res.status})`);
    }
  }

  private async deleteFile(path: string): Promise<void> {
    const token = await this.getAccessToken();
    const res = await fetch(`${GRAPH_APPROOT}${path}:`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      this.checkAuth(res);
      if (res.status === 404) return; // Already gone
      throw new Error(`OneDrive delete failed (HTTP ${res.status})`);
    }
  }

  private checkAuth(res: { status: number }): void {
    if (res.status === 401 || res.status === 403) {
      throw new SyncAuthError(`OneDrive auth failed (HTTP ${res.status})`);
    }
  }
}
```

- [ ] **Step 4: Run adapter tests**

```bash
pnpm --filter @keykeykey/core test -- onedrive-adapter.test.ts
```

Expected: All tests pass.

- [ ] **Step 5: Write `onedrive-oauth.test.ts` and `onedrive-oauth.ts`**

Create `packages/core/src/sync/onedrive-oauth.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { ONEDRIVE_ENDPOINTS, ONEDRIVE_SCOPE, buildOneDriveAuthUrl } from './onedrive-oauth.js';

describe('onedrive-oauth', () => {
  it('has correct endpoints', () => {
    expect(ONEDRIVE_ENDPOINTS.authEndpoint).toBe(
      'https://login.microsoftonline.com/consumers/oauth2/v2/authorize',
    );
    expect(ONEDRIVE_ENDPOINTS.tokenEndpoint).toBe(
      'https://login.microsoftonline.com/consumers/oauth2/v2/token',
    );
    expect(ONEDRIVE_ENDPOINTS.revokeEndpoint).toBeUndefined();
  });

  it('scope includes Files.ReadWrite.AppFolder and offline_access', () => {
    expect(ONEDRIVE_SCOPE).toContain('Files.ReadWrite.AppFolder');
    expect(ONEDRIVE_SCOPE).toContain('offline_access');
  });

  it('buildOneDriveAuthUrl uses correct scope', async () => {
    const url = await buildOneDriveAuthUrl({
      clientId: 'test',
      redirectUri: 'http://localhost',
      codeVerifier: 'v',
    });
    const parsed = new URL(url);
    expect(parsed.searchParams.get('scope')).toBe(ONEDRIVE_SCOPE);
  });
});
```

Create `packages/core/src/sync/onedrive-oauth.ts`:

```typescript
/**
 * OneDrive OAuth 2.0 helpers — thin wrapper over generic oauth.ts.
 *
 * Uses Microsoft Identity Platform (consumers endpoint for personal accounts).
 *
 * @module sync/onedrive-oauth
 */

import { buildAuthUrl, exchangeAuthCode, createCachedTokenProvider } from './oauth.js';
import type { OAuthEndpoints, ExchangeAuthCodeParams, TokenResponse } from './oauth.js';

export { generateCodeVerifier } from './oauth.js';

export const ONEDRIVE_ENDPOINTS: OAuthEndpoints = {
  authEndpoint: 'https://login.microsoftonline.com/consumers/oauth2/v2/authorize',
  tokenEndpoint: 'https://login.microsoftonline.com/consumers/oauth2/v2/token',
  // Microsoft has no simple token revocation endpoint
};

export const ONEDRIVE_SCOPE = 'Files.ReadWrite.AppFolder offline_access';

export async function buildOneDriveAuthUrl(params: {
  clientId: string;
  redirectUri: string;
  codeVerifier: string;
  state?: string;
}): Promise<string> {
  return buildAuthUrl({
    endpoints: ONEDRIVE_ENDPOINTS,
    clientId: params.clientId,
    redirectUri: params.redirectUri,
    codeVerifier: params.codeVerifier,
    scope: ONEDRIVE_SCOPE,
    state: params.state,
    extraParams: { response_mode: 'query' },
  });
}

export async function exchangeOneDriveAuthCode(params: {
  code: string;
  clientId: string;
  redirectUri: string;
  codeVerifier: string;
}): Promise<TokenResponse> {
  return exchangeAuthCode({
    tokenEndpoint: ONEDRIVE_ENDPOINTS.tokenEndpoint,
    ...params,
  });
}

export function createOneDriveTokenProvider(
  refreshToken: string,
  clientId: string,
): () => Promise<string> {
  return createCachedTokenProvider(ONEDRIVE_ENDPOINTS.tokenEndpoint, refreshToken, clientId);
}
```

- [ ] **Step 6: Run all OneDrive tests**

```bash
pnpm --filter @keykeykey/core test -- onedrive
```

Expected: All tests pass.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/sync/onedrive-adapter.ts packages/core/src/sync/onedrive-adapter.test.ts packages/core/src/sync/onedrive-oauth.ts packages/core/src/sync/onedrive-oauth.test.ts
git commit -m "feat(core): add OneDrive sync adapter with OAuth"
```

---

## Task 5: Wire new providers into sync-config and exports

**Files:**

- Modify: `packages/core/src/sync/sync-config.ts`
- Modify: `packages/core/src/sync/sync-lifecycle.ts`
- Modify: `packages/core/src/sync/sync-config.test.ts`
- Modify: `packages/core/src/sync/index.ts`

- [ ] **Step 1: Update `sync-config.ts`**

In `packages/core/src/sync/sync-config.ts`:

Add imports:

```typescript
import { DropboxAdapter } from './dropbox-adapter.js';
import { createDropboxTokenProvider } from './dropbox-oauth.js';
import { OneDriveAdapter } from './onedrive-adapter.js';
import { createOneDriveTokenProvider } from './onedrive-oauth.js';
```

Update `SyncProvider`:

```typescript
export type SyncProvider = 'none' | 'webdav' | 'google-drive' | 'dropbox' | 'onedrive';
```

Update `SyncConfigSchema` enum and add fields:

```typescript
provider: z.enum(['none', 'webdav', 'google-drive', 'dropbox', 'onedrive']),
// ... existing fields ...
dropbox: z.object({ refreshToken: z.string(), clientId: z.string() }).optional(),
onedrive: z.object({ refreshToken: z.string(), clientId: z.string() }).optional(),
```

Add cases in `createAdapterFromConfig()`:

```typescript
case 'dropbox': {
  if (!config.dropbox) {
    throw new Error('Dropbox config requires dropbox settings');
  }
  const { refreshToken, clientId } = config.dropbox;
  return new DropboxAdapter({
    getAccessToken: createDropboxTokenProvider(refreshToken, clientId),
  });
}
case 'onedrive': {
  if (!config.onedrive) {
    throw new Error('OneDrive config requires onedrive settings');
  }
  const { refreshToken, clientId } = config.onedrive;
  return new OneDriveAdapter({
    getAccessToken: createOneDriveTokenProvider(refreshToken, clientId),
  });
}
```

Update `getAvailableProviders()`:

```typescript
export function getAvailableProviders(): SyncProvider[] {
  return ['none', 'webdav', 'google-drive', 'dropbox', 'onedrive'];
}
```

Remove `AdapterPlatformCallbacks` interface entirely (no longer needed — all adapters are HTTP-based). Update `createAdapterFromConfig` to remove the `platform` parameter. Update `createSyncEngineFromConfig` to remove `platformCallbacks`.

**Note:** This is a breaking change. The `platform` parameter on `getAvailableProviders()` and `platformCallbacks` on `createAdapterFromConfig()` / `createSyncEngineFromConfig()` are removed. All call sites must be updated.

- [ ] **Step 2: Update `sync-lifecycle.ts`**

In `packages/core/src/sync/sync-lifecycle.ts`:

- Remove `import type { AdapterPlatformCallbacks } from './sync-config.js';` (line 10)
- Remove `private _platformCallbacks: AdapterPlatformCallbacks;` field (line 79)
- Remove `platformCallbacks: AdapterPlatformCallbacks;` from the constructor options (line 90)
- Remove `this._platformCallbacks = options.platformCallbacks;` assignment (line 97)
- Update all `createAdapterFromConfig(config, this._platformCallbacks)` calls to `createAdapterFromConfig(config)` (lines 216, 261, 329, 404, 436)

- [ ] **Step 3: Update `index.ts` exports**

Add new exports. Also remove `AdapterPlatformCallbacks` from the type exports (currently on the `export type { SyncConfig, SyncProvider, AdapterPlatformCallbacks }` line — remove `AdapterPlatformCallbacks`):

```typescript
export { DropboxAdapter } from './dropbox-adapter.js';
export type { DropboxAdapterOptions } from './dropbox-adapter.js';
export {
  DROPBOX_ENDPOINTS,
  buildDropboxAuthUrl,
  exchangeDropboxAuthCode,
  createDropboxTokenProvider,
  revokeDropboxToken,
} from './dropbox-oauth.js';
export { OneDriveAdapter } from './onedrive-adapter.js';
export type { OneDriveAdapterOptions } from './onedrive-adapter.js';
export {
  ONEDRIVE_ENDPOINTS,
  ONEDRIVE_SCOPE,
  buildOneDriveAuthUrl,
  exchangeOneDriveAuthCode,
  createOneDriveTokenProvider,
} from './onedrive-oauth.js';
```

- [ ] **Step 4: Update `sync-config.test.ts`**

Add test cases for:

- `createAdapterFromConfig` with `'dropbox'` provider (missing config throws, valid config creates adapter)
- `createAdapterFromConfig` with `'onedrive'` provider (missing config throws, valid config creates adapter)
- `getAvailableProviders()` returns all five providers (no platform argument)
- Config encrypt/decrypt round-trip with dropbox and onedrive configs

- [ ] **Step 5: Run all core tests**

```bash
pnpm --filter @keykeykey/core test
```

Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/sync/sync-config.ts packages/core/src/sync/sync-lifecycle.ts packages/core/src/sync/sync-config.test.ts packages/core/src/sync/index.ts
git commit -m "feat(core): wire Dropbox and OneDrive into sync config"
```

---

## Task 6: Rename Tauri OAuth commands

**Files:**

- Modify: `apps/desktop/src-tauri/src/oauth_server.rs`
- Modify: `apps/desktop/src-tauri/src/lib.rs`
- Modify: `apps/desktop/src/lib/google-oauth.ts`

- [ ] **Step 1: Rename Rust commands**

In `apps/desktop/src-tauri/src/oauth_server.rs`:

- Update module doc comment (line 1): change "Google Drive" to "OAuth provider"
- Rename `start_google_oauth` to `start_oauth` (line 31)
- Rename `await_google_oauth_code` to `await_oauth_code` (line 77)
- Update comment on line 44: "Store the receiver and port so `await_oauth_code` can retrieve them."

- [ ] **Step 2: Update command registration in `lib.rs`**

In `apps/desktop/src-tauri/src/lib.rs`, lines 65-67, change:

```rust
// OAuth (loopback flow)
oauth_server::start_oauth,
oauth_server::await_oauth_code,
```

- [ ] **Step 3: Update desktop `google-oauth.ts`**

In `apps/desktop/src/lib/google-oauth.ts`, change:

```typescript
const port = await invoke<number>('start_oauth', { expectedState: state });
```

and:

```typescript
const code = await invoke<string>('await_oauth_code');
```

- [ ] **Step 4: Build and verify**

```bash
cd apps/desktop && npx tauri dev &
# Wait for it to start, then kill it — just need to verify compilation
```

Or run just the Rust build:

```bash
cd apps/desktop/src-tauri && cargo build
```

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src-tauri/src/oauth_server.rs apps/desktop/src-tauri/src/lib.rs apps/desktop/src/lib/google-oauth.ts
git commit -m "refactor(desktop): rename OAuth Tauri commands to provider-agnostic names"
```

---

## Task 7: Wire Dropbox/OneDrive into desktop app

**Files:**

- Create: `apps/desktop/src/lib/dropbox-oauth.ts`
- Create: `apps/desktop/src/lib/onedrive-oauth.ts`
- Modify: `apps/desktop/src/screens/SyncSettingsScreen.tsx`
- Modify: `apps/desktop/src/screens/RestoreScreen.tsx`
- Modify: `apps/desktop/src/screens/SettingsScreen.tsx`
- Modify: `apps/desktop/src/screens/__tests__/SyncSettingsScreen.test.tsx`
- Modify: `apps/desktop/src/lib/vault-context.tsx` (remove `platformCallbacks: {}` from SyncLifecycle construction)

- [ ] **Step 1: Create `apps/desktop/src/lib/dropbox-oauth.ts`**

Follow the pattern from `google-oauth.ts`:

```typescript
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-shell';
import {
  generateCodeVerifier,
  buildDropboxAuthUrl,
  exchangeDropboxAuthCode,
  revokeDropboxToken,
} from '@keykeykey/core/sync';

export const DROPBOX_CLIENT_ID = import.meta.env.VITE_DROPBOX_CLIENT_ID ?? '';

function generateState(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function startDropboxOAuth(): Promise<{ refreshToken: string }> {
  const codeVerifier = generateCodeVerifier();
  const state = generateState();

  const port = await invoke<number>('start_oauth', { expectedState: state });
  const redirectUri = `http://127.0.0.1:${port}`;

  const authUrl = await buildDropboxAuthUrl({
    clientId: DROPBOX_CLIENT_ID,
    redirectUri,
    codeVerifier,
    state,
  });

  if (!authUrl.startsWith('https://www.dropbox.com/')) {
    throw new Error('Invalid OAuth URL');
  }

  await open(authUrl);

  const code = await invoke<string>('await_oauth_code');

  const tokens = await exchangeDropboxAuthCode({
    code,
    clientId: DROPBOX_CLIENT_ID,
    redirectUri,
    codeVerifier,
  });

  return { refreshToken: tokens.refreshToken };
}

export { revokeDropboxToken };
```

- [ ] **Step 2: Create `apps/desktop/src/lib/onedrive-oauth.ts`**

```typescript
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-shell';
import {
  generateCodeVerifier,
  buildOneDriveAuthUrl,
  exchangeOneDriveAuthCode,
} from '@keykeykey/core/sync';

export const ONEDRIVE_CLIENT_ID = import.meta.env.VITE_ONEDRIVE_CLIENT_ID ?? '';

function generateState(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function startOneDriveOAuth(): Promise<{ refreshToken: string }> {
  const codeVerifier = generateCodeVerifier();
  const state = generateState();

  const port = await invoke<number>('start_oauth', { expectedState: state });
  const redirectUri = `http://127.0.0.1:${port}`;

  const authUrl = await buildOneDriveAuthUrl({
    clientId: ONEDRIVE_CLIENT_ID,
    redirectUri,
    codeVerifier,
    state,
  });

  if (!authUrl.startsWith('https://login.microsoftonline.com/')) {
    throw new Error('Invalid OAuth URL');
  }

  await open(authUrl);

  const code = await invoke<string>('await_oauth_code');

  const tokens = await exchangeOneDriveAuthCode({
    code,
    clientId: ONEDRIVE_CLIENT_ID,
    redirectUri,
    codeVerifier,
  });

  return { refreshToken: tokens.refreshToken };
}
```

- [ ] **Step 3: Update `SyncSettingsScreen.tsx`**

Remove iCloud:

- Remove the `<option value="icloud" disabled>iCloud (Coming Soon)</option>` block
- Remove the iCloud "Coming Soon" banner (`{syncProvider === 'icloud' && !isConnected && (...)}`

Add Dropbox and OneDrive:

- Add `<option value="dropbox">Dropbox</option>` after Google Drive option
- Add `<option value="onedrive">OneDrive</option>` after Dropbox option
- Import `startDropboxOAuth`, `DROPBOX_CLIENT_ID`, `revokeDropboxToken` from `../lib/dropbox-oauth`
- Import `startOneDriveOAuth`, `ONEDRIVE_CLIENT_ID` from `../lib/onedrive-oauth`
- Add `handleDropboxConnect` handler (same pattern as `handleGoogleConnect` — validate master password, call `startDropboxOAuth()`, build config with `{ provider: 'dropbox', masterPassword, dropbox: { refreshToken, clientId } }`, save and sync)
- Add `handleOneDriveConnect` handler (same pattern — call `startOneDriveOAuth()`, build config with `{ provider: 'onedrive', masterPassword, onedrive: { refreshToken, clientId } }`)
- Add master password input for Dropbox and OneDrive (same as Google Drive)
- Add sign-in buttons for Dropbox and OneDrive:

```tsx
{
  syncProvider === 'dropbox' && !isConnected && (
    <div style={{ marginBottom: 8 }}>
      <TextInput
        label="Master Password"
        value={masterPassword}
        onChangeText={setMasterPassword}
        placeholder="Enter your vault master password"
        secureTextEntry
        testId="sync-master-password"
      />
    </div>
  );
}
{
  syncProvider === 'onedrive' && !isConnected && (
    <div style={{ marginBottom: 8 }}>
      <TextInput
        label="Master Password"
        value={masterPassword}
        onChangeText={setMasterPassword}
        placeholder="Enter your vault master password"
        secureTextEntry
        testId="sync-master-password"
      />
    </div>
  );
}
```

```tsx
{
  syncProvider === 'dropbox' && (
    <Button
      title={connecting ? 'Signing in...' : 'Sign in with Dropbox'}
      onPress={handleDropboxConnect}
      variant="primary"
      loading={connecting}
      disabled={!masterPassword.trim() || connecting}
    />
  );
}
{
  syncProvider === 'onedrive' && (
    <Button
      title={connecting ? 'Signing in...' : 'Sign in with Microsoft'}
      onPress={handleOneDriveConnect}
      variant="primary"
      loading={connecting}
      disabled={!masterPassword.trim() || connecting}
    />
  );
}
```

Update `handleDisconnect` to handle Dropbox token revocation:

```typescript
if (syncConfig?.provider === 'dropbox' && syncConfig.dropbox?.refreshToken) {
  try {
    await revokeDropboxToken(syncConfig.dropbox.refreshToken);
  } catch {
    /* best-effort */
  }
}
// OneDrive has no revocation — nothing to do
```

- [ ] **Step 4: Update `RestoreScreen.tsx`**

- Remove `<option value="icloud" disabled>iCloud (Coming Soon)</option>`
- Add `<option value="dropbox">Dropbox</option>` and `<option value="onedrive">OneDrive</option>`
- Add OAuth sign-in handlers for Dropbox/OneDrive in restore flow (same pattern as Google Drive)

- [ ] **Step 5: Update `SettingsScreen.tsx`**

Remove the iCloud status text check. Add Dropbox and OneDrive status text:

```typescript
: syncConfig?.provider === 'dropbox'
  ? 'Connected via Dropbox'
  : syncConfig?.provider === 'onedrive'
    ? 'Connected via OneDrive'
```

- [ ] **Step 6: Update `vault-context.tsx`**

In `apps/desktop/src/lib/vault-context.tsx`, remove `platformCallbacks: {}` from the `SyncLifecycle` constructor options (line 165).

- [ ] **Step 7: Update `SyncSettingsScreen.test.tsx`**

- Remove iCloud test assertions
- Add test cases for Dropbox and OneDrive options appearing in the selector

- [ ] **Step 8: Build and verify**

```bash
pnpm --filter @keykeykey/desktop build
```

- [ ] **Step 9: Commit**

```bash
git add apps/desktop/
git commit -m "feat(desktop): add Dropbox and OneDrive sync, remove iCloud"
```

---

## Task 8: Wire Dropbox/OneDrive into mobile app

**Files:**

- Create: `apps/mobile/lib/dropbox-oauth.ts`
- Create: `apps/mobile/lib/onedrive-oauth.ts`
- Modify: `apps/mobile/app/settings/sync.tsx`
- Modify: `apps/mobile/app/(tabs)/settings.tsx`
- Modify: `apps/mobile/lib/vault-context.tsx` (remove `platformCallbacks: {}` from SyncLifecycle construction)
- Modify: `apps/mobile/__tests__/screens/sync-settings.test.tsx`

- [ ] **Step 1: Create mobile OAuth files**

Create `apps/mobile/lib/dropbox-oauth.ts` following the pattern from `apps/mobile/lib/google-oauth.ts` — use `expo-auth-session` with `useAuthRequest` or `AuthSession.startAsync`. Use `buildDropboxAuthUrl` from `@keykeykey/core/sync` and `exchangeDropboxAuthCode`.

Create `apps/mobile/lib/onedrive-oauth.ts` — same pattern but with `buildOneDriveAuthUrl` and `exchangeOneDriveAuthCode`.

- [ ] **Step 2: Update `sync.tsx`**

- Remove iCloud from the provider list: remove `{ id: 'icloud', label: 'iCloud (Coming Soon)', comingSoon: true }`
- Add `{ id: 'dropbox', label: 'Dropbox' }` and `{ id: 'onedrive', label: 'OneDrive' }`
- Add `handleDropboxConnect` and `handleOneDriveConnect` handlers
- Add master password inputs and sign-in buttons for Dropbox/OneDrive
- Remove the iCloud "Coming Soon" banner
- Update disconnect to handle Dropbox token revocation

- [ ] **Step 3: Update `settings.tsx`**

Remove `'icloud'` status text, add `'dropbox'` and `'onedrive'` status text.

- [ ] **Step 4: Update `vault-context.tsx`**

In `apps/mobile/lib/vault-context.tsx`, remove `platformCallbacks: {}` from the `SyncLifecycle` constructor options (line 163).

- [ ] **Step 5: Update sync settings test**

Remove iCloud assertions, add Dropbox/OneDrive options.

- [ ] **Step 6: Run tests**

```bash
pnpm --filter @keykeykey/mobile test
```

- [ ] **Step 7: Commit**

```bash
git add apps/mobile/
git commit -m "feat(mobile): add Dropbox and OneDrive sync, remove iCloud"
```

---

## Task 9: Wire Dropbox/OneDrive into extension

**Files:**

- Create: `apps/extension/src/lib/dropbox-oauth.ts`
- Create: `apps/extension/src/lib/onedrive-oauth.ts`
- Modify: `apps/extension/src/popup/screens/SyncSettingsScreen.tsx`
- Modify: `apps/extension/src/popup/screens/RestoreScreen.tsx`
- Modify: `apps/extension/src/lib/messages.ts`
- Modify: `apps/extension/src/background/message-handler.ts`
- Modify: `apps/extension/src/background/sync.ts` (remove platformCallbacks)
- Modify: `apps/extension/src/popup/screens/SyncSettingsScreen.test.tsx`

- [ ] **Step 1: Create extension OAuth files**

Create `apps/extension/src/lib/dropbox-oauth.ts` following the pattern from `apps/extension/src/lib/google-oauth.ts` — use `browser.identity.launchWebAuthFlow` with `buildDropboxAuthUrl`.

Create `apps/extension/src/lib/onedrive-oauth.ts` — same pattern with `buildOneDriveAuthUrl`.

- [ ] **Step 2: Add message types**

In `apps/extension/src/lib/messages.ts`, add:

```typescript
DROPBOX_OAUTH_CONNECT = 'DROPBOX_OAUTH_CONNECT',
DROPBOX_OAUTH_DISCONNECT = 'DROPBOX_OAUTH_DISCONNECT',
ONEDRIVE_OAUTH_CONNECT = 'ONEDRIVE_OAUTH_CONNECT',
ONEDRIVE_OAUTH_DISCONNECT = 'ONEDRIVE_OAUTH_DISCONNECT',
```

- [ ] **Step 3: Update `message-handler.ts`**

Add handlers for Dropbox/OneDrive OAuth connect/disconnect messages. Follow the Google Drive handler pattern.

- [ ] **Step 4: Update `SyncSettingsScreen.tsx`**

- Remove `<option value="icloud" disabled>iCloud (Coming Soon)</option>`
- Add `<option value="dropbox">Dropbox</option>` and `<option value="onedrive">OneDrive</option>`
- Add connect handlers and sign-in buttons for both providers
- Update disconnect to handle Dropbox token revocation

- [ ] **Step 5: Update `RestoreScreen.tsx`**

- Remove iCloud option
- Add Dropbox and OneDrive options with OAuth flows

- [ ] **Step 6: Update `sync.ts`**

In `apps/extension/src/background/sync.ts`, remove `platformCallbacks: {}` from the `SyncLifecycle` constructor options (line 56).

- [ ] **Step 7: Update test file**

Remove iCloud assertions, add Dropbox/OneDrive.

- [ ] **Step 8: Run tests**

```bash
pnpm --filter @keykeykey/extension test
```

- [ ] **Step 9: Commit**

```bash
git add apps/extension/
git commit -m "feat(extension): add Dropbox and OneDrive sync, remove iCloud"
```

---

## Task 10: Update documentation

**Files:**

- Modify: `implementationplan.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update `implementationplan.md`**

In the Cloud Sync section, replace iCloud references:

- Change `"File Providers: WebDAV, Google Drive API, iCloud Drive."` to `"File Providers: WebDAV, Google Drive, Dropbox, OneDrive."`

- [ ] **Step 2: Update `CLAUDE.md`**

- Update any references to `APPLE_PLATFORMS` or platform-gating
- Update the `SyncProvider` type if mentioned
- Update the sync provider list

- [ ] **Step 3: Commit**

```bash
git add implementationplan.md CLAUDE.md
git commit -m "docs: update sync provider references (replace iCloud with Dropbox/OneDrive)"
```

---

## Task 11: Final verification

- [ ] **Step 1: Build all packages**

```bash
pnpm build
```

- [ ] **Step 2: Run all tests**

```bash
pnpm test
```

- [ ] **Step 3: Lint and format**

```bash
pnpm lint && pnpm format:check
```

- [ ] **Step 4: Run critical e2e tests**

```bash
cd e2e && npx playwright test --grep @critical
```

- [ ] **Step 5: Verify no remaining iCloud sync references**

```bash
# Should only find iCloud Keychain in import screens
grep -r "icloud\|iCloud\|ICloud" --include="*.ts" --include="*.tsx" packages/ apps/ | grep -v "node_modules" | grep -v "iCloud Keychain" | grep -v ".test."
```

Expected: No results (only "iCloud Keychain" import references should remain, filtered out above).

- [ ] **Step 6: Final commit if needed**

Fix any lint/format issues and commit.
