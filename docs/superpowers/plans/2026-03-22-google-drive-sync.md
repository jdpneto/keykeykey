# Google Drive Sync Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable Google Drive as a sync provider across desktop (Tauri), mobile (Expo), and browser extension (Chrome/Firefox/Safari), using the existing `GoogleDriveAdapter` and sync infrastructure.

**Architecture:** Core gets a `google-oauth.ts` module with PKCE, token exchange, refresh, and caching. Each platform implements a thin OAuth flow (Tauri loopback server, expo-auth-session, browser.identity.launchWebAuthFlow). The existing `createAdapterFromConfig` factory is updated to use cached token refresh instead of platform callbacks. All UIs are updated to enable Google Drive selection with a "Sign in with Google" button.

**Tech Stack:** TypeScript, React, Rust (Tauri), Expo, WebExtensions API, Google OAuth 2.0, Google Drive REST API v3

**Spec:** `docs/superpowers/specs/2026-03-22-google-drive-sync-design.md`

---

### Task 1: Core — Google OAuth Token Helpers

**Files:**

- Create: `packages/core/src/sync/google-oauth.ts`
- Create: `packages/core/src/sync/google-oauth.test.ts`
- Modify: `packages/core/src/sync/index.ts`

- [ ] **Step 1: Write failing tests for PKCE helpers**

In `packages/core/src/sync/google-oauth.test.ts`:

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
  GoogleOAuthError,
} from './google-oauth.js';

describe('PKCE helpers', () => {
  it('generateCodeVerifier returns a 43-128 char URL-safe string', () => {
    const verifier = generateCodeVerifier();
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(verifier.length).toBeLessThanOrEqual(128);
    expect(verifier).toMatch(/^[A-Za-z0-9\-._~]+$/);
  });

  it('generateCodeVerifier produces unique values', () => {
    const a = generateCodeVerifier();
    const b = generateCodeVerifier();
    expect(a).not.toBe(b);
  });

  it('generateCodeChallenge returns base64url-encoded SHA-256 hash', async () => {
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    const challenge = await generateCodeChallenge(verifier);
    // Known SHA-256 of the above verifier (from RFC 7636 Appendix B)
    expect(challenge).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @keykeykey/core test -- --grep "PKCE helpers"`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement PKCE helpers**

Create `packages/core/src/sync/google-oauth.ts`:

```typescript
/**
 * Google OAuth 2.0 helpers for public clients (PKCE, token exchange, refresh).
 *
 * All functions are platform-agnostic (fetch-based, no native deps).
 * Used by desktop (Tauri), mobile (Expo), and browser extension OAuth flows.
 */

import { SyncAuthError } from './errors.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const DEFAULT_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

export class GoogleOAuthError extends Error {
  constructor(
    public readonly error: string,
    public readonly errorDescription: string,
  ) {
    super(`${error}: ${errorDescription}`);
    this.name = 'GoogleOAuthError';
  }
}

// ---------------------------------------------------------------------------
// PKCE (RFC 7636)
// ---------------------------------------------------------------------------

/** Generate a cryptographically random code verifier (43-128 chars, URL-safe). */
export function generateCodeVerifier(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

/** Compute the S256 code challenge for a given verifier. */
export async function generateCodeChallenge(verifier: string): Promise<string> {
  const data = new TextEncoder().encode(verifier);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
  return base64UrlEncode(digest);
}

// ---------------------------------------------------------------------------
// Auth URL
// ---------------------------------------------------------------------------

export interface BuildAuthUrlParams {
  clientId: string;
  redirectUri: string;
  codeVerifier: string;
  scope?: string;
  loginHint?: string;
  state?: string;
}

/**
 * Build the Google OAuth consent URL.
 *
 * Always includes `access_type=offline` and `prompt=consent` to ensure
 * a refresh token is returned.
 */
export async function buildAuthUrl(params: BuildAuthUrlParams): Promise<string> {
  const challenge = await generateCodeChallenge(params.codeVerifier);
  const url = new URL(GOOGLE_AUTH_URL);
  url.searchParams.set('client_id', params.clientId);
  url.searchParams.set('redirect_uri', params.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', params.scope ?? DEFAULT_SCOPE);
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent');
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  if (params.state) url.searchParams.set('state', params.state);
  if (params.loginHint) url.searchParams.set('login_hint', params.loginHint);
  return url.toString();
}

// ---------------------------------------------------------------------------
// Token exchange
// ---------------------------------------------------------------------------

export interface ExchangeAuthCodeParams {
  code: string;
  clientId: string;
  redirectUri: string;
  codeVerifier: string;
}

export interface TokenResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

/** Exchange an authorization code for access + refresh tokens. */
export async function exchangeAuthCode(params: ExchangeAuthCodeParams): Promise<TokenResponse> {
  const body = new URLSearchParams({
    code: params.code,
    client_id: params.clientId,
    redirect_uri: params.redirectUri,
    code_verifier: params.codeVerifier,
    grant_type: 'authorization_code',
  });

  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  const data = (await res.json()) as Record<string, unknown>;
  if (!res.ok || data.error) {
    throw new GoogleOAuthError(
      String(data.error ?? 'token_exchange_failed'),
      String(data.error_description ?? 'Token exchange failed'),
    );
  }

  return {
    accessToken: data.access_token as string,
    refreshToken: data.refresh_token as string,
    expiresIn: data.expires_in as number,
  };
}

// ---------------------------------------------------------------------------
// Token refresh
// ---------------------------------------------------------------------------

export interface RefreshParams {
  refreshToken: string;
  clientId: string;
}

export interface RefreshResponse {
  accessToken: string;
  expiresIn: number;
}

/** Refresh an access token using a stored refresh token. */
export async function refreshAccessToken(params: RefreshParams): Promise<RefreshResponse> {
  const body = new URLSearchParams({
    refresh_token: params.refreshToken,
    client_id: params.clientId,
    grant_type: 'refresh_token',
  });

  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  const data = (await res.json()) as Record<string, unknown>;
  if (!res.ok || data.error) {
    if (data.error === 'invalid_grant') {
      throw new SyncAuthError(
        'Google Drive disconnected — sign in again to continue syncing.',
      );
    }
    throw new GoogleOAuthError(
      String(data.error ?? 'refresh_failed'),
      String(data.error_description ?? 'Token refresh failed'),
    );
  }

  return {
    accessToken: data.access_token as string,
    expiresIn: data.expires_in as number,
  };
}

// ---------------------------------------------------------------------------
// Token revocation
// ---------------------------------------------------------------------------

/** Revoke a refresh token (best-effort, does not throw on failure). */
export async function revokeToken(token: string): Promise<void> {
  try {
    await fetch(`${GOOGLE_REVOKE_URL}?token=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
  } catch {
    // Best-effort — token revocation failure is not critical
  }
}

// ---------------------------------------------------------------------------
// Cached token provider
// ---------------------------------------------------------------------------

/**
 * Create a token provider that caches access tokens and refreshes
 * them 60 seconds before expiry. Used by createAdapterFromConfig.
 */
export function createCachedTokenProvider(
  refreshToken: string,
  clientId: string,
): () => Promise<string> {
  let cached: { accessToken: string; expiresAt: number } | null = null;

  return async (): Promise<string> => {
    if (!cached || Date.now() >= cached.expiresAt - 60_000) {
      const result = await refreshAccessToken({ refreshToken, clientId });
      cached = {
        accessToken: result.accessToken,
        expiresAt: Date.now() + result.expiresIn * 1000,
      };
    }
    return cached.accessToken;
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
```

- [ ] **Step 4: Run PKCE tests to verify they pass**

Run: `pnpm --filter @keykeykey/core test -- --grep "PKCE helpers"`
Expected: PASS

- [ ] **Step 5: Write failing tests for buildAuthUrl**

Add to `google-oauth.test.ts`:

```typescript
describe('buildAuthUrl', () => {
  it('includes required OAuth parameters', async () => {
    const verifier = generateCodeVerifier();
    const url = await buildAuthUrl({
      clientId: 'test-client-id',
      redirectUri: 'http://127.0.0.1:8080',
      codeVerifier: verifier,
    });
    const parsed = new URL(url);
    expect(parsed.origin).toBe('https://accounts.google.com');
    expect(parsed.searchParams.get('client_id')).toBe('test-client-id');
    expect(parsed.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:8080');
    expect(parsed.searchParams.get('response_type')).toBe('code');
    expect(parsed.searchParams.get('access_type')).toBe('offline');
    expect(parsed.searchParams.get('prompt')).toBe('consent');
    expect(parsed.searchParams.get('code_challenge_method')).toBe('S256');
    expect(parsed.searchParams.get('code_challenge')).toBeTruthy();
    expect(parsed.searchParams.get('scope')).toContain('drive.appdata');
  });

  it('includes state parameter when provided', async () => {
    const url = await buildAuthUrl({
      clientId: 'cid',
      redirectUri: 'http://localhost',
      codeVerifier: generateCodeVerifier(),
      state: 'random-state-123',
    });
    expect(new URL(url).searchParams.get('state')).toBe('random-state-123');
  });
});
```

- [ ] **Step 6: Run buildAuthUrl tests**

Run: `pnpm --filter @keykeykey/core test -- --grep "buildAuthUrl"`
Expected: PASS (already implemented in step 3)

- [ ] **Step 7: Write failing tests for token exchange and refresh**

Add to `google-oauth.test.ts`:

```typescript
describe('exchangeAuthCode', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('exchanges code for tokens', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          access_token: 'at-123',
          refresh_token: 'rt-456',
          expires_in: 3600,
        }),
        { status: 200 },
      ),
    );

    const result = await exchangeAuthCode({
      code: 'auth-code',
      clientId: 'cid',
      redirectUri: 'http://localhost',
      codeVerifier: 'verifier',
    });

    expect(result.accessToken).toBe('at-123');
    expect(result.refreshToken).toBe('rt-456');
    expect(result.expiresIn).toBe(3600);
  });

  it('throws GoogleOAuthError on failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          error: 'invalid_grant',
          error_description: 'Code expired',
        }),
        { status: 400 },
      ),
    );

    await expect(
      exchangeAuthCode({
        code: 'bad-code',
        clientId: 'cid',
        redirectUri: 'http://localhost',
        codeVerifier: 'verifier',
      }),
    ).rejects.toThrow(GoogleOAuthError);
  });
});

describe('refreshAccessToken', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('refreshes access token', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ access_token: 'new-at', expires_in: 3600 }),
        { status: 200 },
      ),
    );

    const result = await refreshAccessToken({
      refreshToken: 'rt-456',
      clientId: 'cid',
    });

    expect(result.accessToken).toBe('new-at');
    expect(result.expiresIn).toBe(3600);
  });

  it('throws SyncAuthError on invalid_grant', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          error: 'invalid_grant',
          error_description: 'Token revoked',
        }),
        { status: 400 },
      ),
    );

    const { SyncAuthError } = await import('./errors.js');
    await expect(
      refreshAccessToken({ refreshToken: 'expired', clientId: 'cid' }),
    ).rejects.toThrow(SyncAuthError);
  });
});

describe('revokeToken', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('calls revoke endpoint', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('', { status: 200 }),
    );
    await revokeToken('rt-456');
    expect(spy).toHaveBeenCalledOnce();
    expect(spy.mock.calls[0][0]).toContain('revoke');
  });

  it('does not throw on failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network'));
    await expect(revokeToken('rt-456')).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 8: Run token tests**

Run: `pnpm --filter @keykeykey/core test -- --grep "exchangeAuthCode|refreshAccessToken|revokeToken"`
Expected: PASS

- [ ] **Step 9: Write failing test for createCachedTokenProvider**

Add to `google-oauth.test.ts`:

```typescript
describe('createCachedTokenProvider', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('caches token and reuses it within expiry window', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ access_token: 'cached-at', expires_in: 3600 }),
        { status: 200 },
      ),
    );

    const getToken = createCachedTokenProvider('rt', 'cid');
    const t1 = await getToken();
    const t2 = await getToken();
    expect(t1).toBe('cached-at');
    expect(t2).toBe('cached-at');
    // Only one fetch call — token was cached
    expect(spy).toHaveBeenCalledOnce();
  });

  it('refreshes when token is near expiry', async () => {
    let callCount = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      callCount++;
      return new Response(
        JSON.stringify({
          access_token: `at-${callCount}`,
          expires_in: 0, // immediately expired
        }),
        { status: 200 },
      );
    });

    const getToken = createCachedTokenProvider('rt', 'cid');
    const t1 = await getToken();
    const t2 = await getToken();
    expect(t1).toBe('at-1');
    expect(t2).toBe('at-2');
  });
});
```

- [ ] **Step 10: Run cached token tests**

Run: `pnpm --filter @keykeykey/core test -- --grep "createCachedTokenProvider"`
Expected: PASS

- [ ] **Step 11: Export from sync index**

In `packages/core/src/sync/index.ts`, add after the `GoogleDriveAdapter` export (line 25):

```typescript
export {
  generateCodeVerifier,
  generateCodeChallenge,
  buildAuthUrl,
  exchangeAuthCode,
  refreshAccessToken,
  revokeToken,
  createCachedTokenProvider,
  GoogleOAuthError,
} from './google-oauth.js';
export type {
  BuildAuthUrlParams,
  ExchangeAuthCodeParams,
  TokenResponse,
  RefreshParams,
  RefreshResponse,
} from './google-oauth.js';
```

- [ ] **Step 12: Run all core tests**

Run: `pnpm --filter @keykeykey/core test`
Expected: All tests pass.

- [ ] **Step 13: Commit**

```bash
git add packages/core/src/sync/google-oauth.ts packages/core/src/sync/google-oauth.test.ts packages/core/src/sync/index.ts
git commit -m "feat(core): add Google OAuth token helpers with PKCE and caching"
```

---

### Task 2: Core — Update SyncConfig for Google Drive

**Files:**

- Modify: `packages/core/src/sync/sync-config.ts:22-28,65-105`
- Modify: `packages/core/src/sync/sync-config.test.ts:25-33,84-118`

This task updates the Zod schema to require `clientId` in the googleDrive config, replaces the `getAccessToken`/`getChromeAccessToken` platform callbacks with the core `createCachedTokenProvider`, and updates tests.

- [ ] **Step 1: Update the SyncConfigSchema**

In `packages/core/src/sync/sync-config.ts`, change line 26:

```typescript
googleDrive: z.object({ refreshToken: z.string() }).optional(),
```

to:

```typescript
googleDrive: z.object({ refreshToken: z.string(), clientId: z.string() }).optional(),
```

- [ ] **Step 2: Add import for createCachedTokenProvider**

In `packages/core/src/sync/sync-config.ts`, add to the imports at the top:

```typescript
import { createCachedTokenProvider } from './google-oauth.js';
```

- [ ] **Step 3: Simplify AdapterPlatformCallbacks and createAdapterFromConfig**

In `packages/core/src/sync/sync-config.ts`, replace the `AdapterPlatformCallbacks` interface (lines 65-69):

```typescript
export interface AdapterPlatformCallbacks {
  icloudFs?: ICloudFs;
}
```

Replace the google-drive case in `createAdapterFromConfig` (lines 91-105):

```typescript
    case 'google-drive': {
      if (!config.googleDrive) {
        throw new Error('Google Drive config requires googleDrive settings');
      }
      const { refreshToken, clientId } = config.googleDrive;
      return new GoogleDriveAdapter({
        getAccessToken: createCachedTokenProvider(refreshToken, clientId),
      });
    }
```

- [ ] **Step 4: Update tests for new schema**

In `packages/core/src/sync/sync-config.test.ts`:

Update the Google Drive encrypt/decrypt test (line 28):

```typescript
  it('should round-trip encrypt/decrypt a Google Drive config', () => {
    const config: SyncConfig = {
      provider: 'google-drive',
      googleDrive: { refreshToken: 'token-123', clientId: 'cid-456' },
    };
    const encrypted = encryptSyncConfig(config, dek);
    const decrypted = decryptSyncConfig(encrypted, dek);
    expect(decrypted).toEqual(config);
  });
```

Update the GoogleDriveAdapter creation test (lines 84-94):

```typescript
  it('should return GoogleDriveAdapter for google-drive provider', () => {
    const config: SyncConfig = {
      provider: 'google-drive',
      googleDrive: { refreshToken: 'tok', clientId: 'cid' },
    };
    const adapter = createAdapterFromConfig(config, {});
    expect(adapter).not.toBeNull();
    expect(adapter!.constructor.name).toBe('GoogleDriveAdapter');
  });
```

Remove the `__chrome_managed__` sentinel test (lines 96-104) entirely.

Update the missing token callback test (lines 114-118) — it should now pass since no callback is needed:

Replace with:

```typescript
  it('should create adapter without platform callbacks for google-drive', () => {
    const config: SyncConfig = {
      provider: 'google-drive',
      googleDrive: { refreshToken: 'tok', clientId: 'cid' },
    };
    // No platform callbacks needed — core handles token refresh
    const adapter = createAdapterFromConfig(config, {});
    expect(adapter).not.toBeNull();
  });
```

- [ ] **Step 5: Run all core tests**

Run: `pnpm --filter @keykeykey/core test`
Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/sync/sync-config.ts packages/core/src/sync/sync-config.test.ts
git commit -m "feat(core): update SyncConfig schema for Google Drive, remove platform token callbacks"
```

---

### Task 3: Desktop — Rust Loopback OAuth Server

**Files:**

- Create: `apps/desktop/src-tauri/src/oauth_server.rs`
- Modify: `apps/desktop/src-tauri/src/lib.rs:3,40-60`
- Modify: `apps/desktop/src-tauri/Cargo.toml:15-28`

- [ ] **Step 1: Add tokio dependency**

In `apps/desktop/src-tauri/Cargo.toml`, add to `[dependencies]` (after the `url` line):

```toml
tokio = { version = "1", features = ["sync", "time"] }
```

Note: `reqwest` already pulls in `tokio` as a transitive dep. We only need `sync` (for oneshot channel) and `time` (for timeout). The TCP listener uses `std::net` (blocking).

- [ ] **Step 2: Create oauth_server.rs**

Create `apps/desktop/src-tauri/src/oauth_server.rs`:

```rust
//! One-shot loopback HTTP server for Google OAuth redirect.
//!
//! Binds to `127.0.0.1:0` (OS-assigned port), waits for Google's redirect
//! with the auth code, responds with a success page, then shuts down.
//!
//! Uses std::net (blocking) in a spawned thread for simplicity — a one-shot
//! server doesn't benefit from async I/O.

use std::sync::Arc;
use tauri::State;
use tokio::sync::Mutex;

/// Shared state for the OAuth flow.
pub struct OAuthState {
    /// Channel receiver — the frontend awaits the auth code through this.
    receiver: Mutex<Option<tokio::sync::oneshot::Receiver<String>>>,
}

impl OAuthState {
    pub fn new() -> Self {
        Self {
            receiver: Mutex::new(None),
        }
    }
}

/// Start the loopback OAuth server. Returns the port number.
///
/// Spawns a blocking thread that accepts a single connection, extracts the
/// auth code from Google's redirect, validates the state parameter, sends
/// a success HTML page, and forwards the code via a oneshot channel.
#[tauri::command]
pub async fn start_google_oauth(
    expected_state: String,
    oauth: State<'_, Arc<OAuthState>>,
) -> Result<u16, String> {
    let listener = std::net::TcpListener::bind("127.0.0.1:0")
        .map_err(|e| format!("Failed to bind: {e}"))?;
    let port = listener
        .local_addr()
        .map_err(|e| format!("Failed to get addr: {e}"))?
        .port();

    // Set a 120-second timeout on accept
    listener
        .set_nonblocking(false)
        .map_err(|e| format!("Failed to set blocking: {e}"))?;

    let (tx, rx) = tokio::sync::oneshot::channel::<String>();
    *oauth.receiver.lock().await = Some(rx);

    std::thread::spawn(move || {
        use std::io::{Read, Write};

        // Wait for a single connection (Google's redirect)
        let Ok((mut stream, _)) = listener.accept() else {
            let _ = tx.send(String::new()); // unblock receiver
            return;
        };

        let mut buf = vec![0u8; 4096];
        let n = stream.read(&mut buf).unwrap_or(0);
        let request = String::from_utf8_lossy(&buf[..n]);

        let (code, state) = parse_oauth_redirect(&request);

        // Validate state parameter (CSRF prevention)
        let valid_state = state.as_deref() == Some(&expected_state);

        let html = if code.is_some() && valid_state {
            "<html><body><h2>Sign-in complete!</h2><p>You can close this tab and return to KeyKeyKey.</p></body></html>"
        } else if !valid_state {
            "<html><body><h2>Sign-in failed</h2><p>Invalid state parameter. Please try again.</p></body></html>"
        } else {
            "<html><body><h2>Sign-in failed</h2><p>No authorization code received. Please try again.</p></body></html>"
        };

        let response = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            html.len(),
            html
        );
        let _ = stream.write_all(response.as_bytes());
        let _ = stream.flush();
        drop(stream);
        drop(listener);

        // Send the auth code (or empty string on failure) through the channel
        if let Some(c) = code.filter(|_| valid_state) {
            let _ = tx.send(c);
        }
        // If tx is dropped without send, receiver gets RecvError
    });

    Ok(port)
}

/// Wait for the OAuth redirect and return the authorization code.
/// Times out after 120 seconds.
#[tauri::command]
pub async fn await_google_oauth_code(
    oauth: State<'_, Arc<OAuthState>>,
) -> Result<String, String> {
    let rx = oauth
        .receiver
        .lock()
        .await
        .take()
        .ok_or("No OAuth flow in progress")?;

    match tokio::time::timeout(std::time::Duration::from_secs(120), rx).await {
        Ok(Ok(code)) if !code.is_empty() => Ok(code),
        Ok(Ok(_)) => Err("OAuth redirect did not contain a valid auth code".into()),
        Ok(Err(_)) => Err("OAuth flow was cancelled or failed".into()),
        Err(_) => Err("OAuth flow timed out (120s)".into()),
    }
}

/// Parse the OAuth redirect URL from the HTTP GET request.
fn parse_oauth_redirect(request: &str) -> (Option<String>, Option<String>) {
    let first_line = request.lines().next().unwrap_or("");
    // e.g. "GET /?code=XXX&state=YYY HTTP/1.1"
    let path = first_line
        .strip_prefix("GET ")
        .and_then(|s| s.split_whitespace().next())
        .unwrap_or("");

    let query = path.split('?').nth(1).unwrap_or("");
    let mut code = None;
    let mut state = None;

    for pair in query.split('&') {
        let mut parts = pair.splitn(2, '=');
        let key = parts.next().unwrap_or("");
        let value = parts.next().unwrap_or("");
        let decoded = urldecode(value);
        match key {
            "code" => code = Some(decoded),
            "state" => state = Some(decoded),
            _ => {}
        }
    }

    (code, state)
}

fn urldecode(s: &str) -> String {
    let mut result = String::with_capacity(s.len());
    let mut chars = s.bytes();
    while let Some(b) = chars.next() {
        if b == b'%' {
            let hi = chars.next().unwrap_or(b'0');
            let lo = chars.next().unwrap_or(b'0');
            let hex = [hi, lo];
            if let Ok(val) = u8::from_str_radix(std::str::from_utf8(&hex).unwrap_or("00"), 16) {
                result.push(val as char);
            }
        } else if b == b'+' {
            result.push(' ');
        } else {
            result.push(b as char);
        }
    }
    result
}
```

- [ ] **Step 3: Wire into lib.rs**

In `apps/desktop/src-tauri/src/lib.rs`:

Add the module declaration (after line 5 `mod http_proxy;`):

```rust
mod oauth_server;
```

Add state management in the `setup` closure (after the `ProxyState` manage call, around line 38):

```rust
app.manage(std::sync::Arc::new(oauth_server::OAuthState::new()));
```

Add commands to the `invoke_handler` (after `set_sync_url_prefix`, around line 60):

```rust
            // OAuth (Google Drive loopback flow)
            oauth_server::start_google_oauth,
            oauth_server::await_google_oauth_code,
```

- [ ] **Step 4: Verify Rust compilation**

Run: `cd apps/desktop/src-tauri && cargo check`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src-tauri/src/oauth_server.rs apps/desktop/src-tauri/src/lib.rs apps/desktop/src-tauri/Cargo.toml
git commit -m "feat(desktop): add Rust loopback OAuth server for Google Drive"
```

---

### Task 4: Desktop — Frontend OAuth Flow & UI

**Files:**

- Create: `apps/desktop/src/lib/google-oauth.ts`
- Delete: `apps/desktop/src/lib/google-auth.ts` (pre-existing stub, replaced by google-oauth.ts)
- Modify: `apps/desktop/src/screens/SyncSettingsScreen.tsx:264-266,359-383`

**Note:** There is a pre-existing `apps/desktop/src/lib/google-auth.ts` stub file that contains a placeholder OAuth implementation. Delete it — our new `google-oauth.ts` replaces it entirely. Check for any imports of `google-auth.ts` and remove them.

- [ ] **Step 1: Create desktop OAuth flow module**

Create `apps/desktop/src/lib/google-oauth.ts`:

```typescript
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-shell';
import {
  generateCodeVerifier,
  buildAuthUrl,
  exchangeAuthCode,
  revokeToken,
} from '@keykeykey/core/sync';

// TODO: Replace with actual GCP Desktop client ID after setup
export const GOOGLE_DRIVE_CLIENT_ID = 'PLACEHOLDER_DESKTOP_CLIENT_ID';

/**
 * Generate a cryptographically random state parameter for CSRF prevention.
 */
function generateState(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Run the full Google OAuth flow via loopback redirect.
 *
 * 1. Start the Rust loopback server (gets random port)
 * 2. Build Google auth URL with PKCE
 * 3. Open in system browser
 * 4. Wait for redirect with auth code
 * 5. Exchange code for tokens
 *
 * @returns The refresh token for storage in SyncConfig
 */
export async function startGoogleOAuth(): Promise<{ refreshToken: string }> {
  const codeVerifier = generateCodeVerifier();
  const state = generateState();

  // Start the loopback server — returns the port
  const port = await invoke<number>('start_google_oauth', {
    expectedState: state,
  });

  const redirectUri = `http://127.0.0.1:${port}`;

  // Build the auth URL
  const authUrl = await buildAuthUrl({
    clientId: GOOGLE_DRIVE_CLIENT_ID,
    redirectUri,
    codeVerifier,
    state,
  });

  // Validate URL before opening (defense-in-depth)
  if (!authUrl.startsWith('https://accounts.google.com/')) {
    throw new Error('Invalid OAuth URL');
  }

  // Open in system browser
  await open(authUrl);

  // Wait for the redirect (120s timeout)
  const code = await invoke<string>('await_google_oauth_code');

  // Exchange auth code for tokens
  const tokens = await exchangeAuthCode({
    code,
    clientId: GOOGLE_DRIVE_CLIENT_ID,
    redirectUri,
    codeVerifier,
  });

  return { refreshToken: tokens.refreshToken };
}

export { revokeToken };
```

- [ ] **Step 2: Update SyncSettingsScreen — enable Google Drive option**

In `apps/desktop/src/screens/SyncSettingsScreen.tsx`, replace the disabled Google Drive option (lines 264-266):

```html
          <option value="google-drive" disabled>
            Google Drive (Coming Soon)
          </option>
```

with:

```html
          <option value="google-drive">Google Drive</option>
```

- [ ] **Step 3: Add Google Drive imports and connect handler**

At the top of `SyncSettingsScreen.tsx`, add:

```typescript
import { startGoogleOAuth, revokeToken, GOOGLE_DRIVE_CLIENT_ID } from '../lib/google-oauth.js';
```

Add a Google Drive connect handler inside the component (near the existing `handleConnect`):

```typescript
  const handleGoogleConnect = async () => {
    if (!masterPassword) {
      setSyncError('Master password is required.');
      return;
    }
    setConnecting(true);
    setSyncError(null);
    try {
      const { refreshToken } = await startGoogleOAuth();
      const config: SyncConfig = {
        provider: 'google-drive',
        masterPassword,
        googleDrive: { refreshToken, clientId: GOOGLE_DRIVE_CLIENT_ID },
      };
      await saveSyncConfig(config);
      const result = await triggerSync();
      if (result.error) {
        setSyncError(result.error);
      } else {
        setLastSynced(result.lastSynced);
      }
      setMasterPassword('');
    } catch (e) {
      setSyncError(e instanceof Error ? e.message : 'Google sign-in failed');
    } finally {
      setConnecting(false);
    }
  };
```

Update the disconnect handler to revoke Google tokens. The refresh token must be retrieved from the current encrypted sync config before revoking. Add a `loadSyncConfig` helper (or read from the existing lifecycle state) to get the stored refresh token:

```typescript
  const handleDisconnect = async () => {
    try {
      // Revoke Google Drive token if applicable
      if (syncProvider === 'google-drive') {
        try {
          const currentConfig = await loadCurrentSyncConfig();
          if (currentConfig?.googleDrive?.refreshToken) {
            await revokeToken(currentConfig.googleDrive.refreshToken);
          }
        } catch {
          // Best-effort revocation — don't block disconnect on failure
        }
      }
      await saveSyncConfig({ provider: 'none' });
      // ... rest of existing disconnect logic
```

The `loadCurrentSyncConfig` function should load and decrypt the stored sync config. If such a helper doesn't already exist in the desktop sync lib, read the encrypted config via `invoke('load_sync_config')` and decrypt it with the DEK from the vault store.

- [ ] **Step 4: Replace the "coming soon" banner with Google Drive connect UI**

In `SyncSettingsScreen.tsx`, replace the "not yet available" banner block (lines 359-383 approximately) with conditional UI:

When `syncProvider === 'google-drive'` and not connected, show:

```tsx
      {syncProvider === 'google-drive' && !isConnected && (
        <>
          <div style={fieldGroupStyle}>
            <label style={labelStyle}>Master Password</label>
            <input
              type="password"
              value={masterPassword}
              onChange={(e) => setMasterPassword(e.target.value)}
              placeholder="Required for sync encryption"
              data-testid="sync-master-password"
              style={inputStyle}
            />
          </div>
          <button
            onClick={handleGoogleConnect}
            disabled={connecting || !masterPassword}
            style={primaryButtonStyle}
          >
            {connecting ? 'Signing in…' : 'Sign in with Google'}
          </button>
        </>
      )}
```

Keep the iCloud "coming soon" banner for `syncProvider === 'icloud'`.

- [ ] **Step 5: Verify TypeScript compilation**

Run: `cd apps/desktop && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 6: Update desktop sync settings tests**

In `apps/desktop/src/screens/__tests__/SyncSettingsScreen.test.tsx`:

Update the "shows coming soon banner for google-drive" test (line 241) to instead verify the Google Drive connect UI appears:

```typescript
  it('shows Sign in with Google button for google-drive', () => {
    renderSyncSettings();
    const select = screen.getByRole('combobox');
    fireEvent.change(select, { target: { value: 'google-drive' } });
    expect(screen.getByText(/Sign in with Google/i)).toBeInTheDocument();
  });
```

Add a mock for the google-oauth module at the top of the test file:

```typescript
vi.mock('../../lib/google-oauth.js', () => ({
  startGoogleOAuth: vi.fn(),
  revokeToken: vi.fn(),
  GOOGLE_DRIVE_CLIENT_ID: 'test-client-id',
}));
```

- [ ] **Step 7: Run desktop tests**

Run: `pnpm --filter @keykeykey/desktop test`
Expected: All tests pass.

- [ ] **Step 8: Commit**

Delete the old stub: `rm apps/desktop/src/lib/google-auth.ts`

```bash
git add apps/desktop/src/lib/google-oauth.ts apps/desktop/src/lib/google-auth.ts apps/desktop/src/screens/SyncSettingsScreen.tsx apps/desktop/src/screens/__tests__/SyncSettingsScreen.test.tsx
git commit -m "feat(desktop): add Google Drive OAuth flow and enable in sync settings UI"
```

---

### Task 5: Mobile — OAuth Flow & UI

**Files:**

- Create: `apps/mobile/lib/google-oauth.ts`
- Delete: `apps/mobile/lib/google-auth.ts` (pre-existing stub, replaced by google-oauth.ts)
- Modify: `apps/mobile/app/settings/sync.tsx:198-202,227,236`
- Modify: `apps/mobile/package.json`

**Note:** Delete the pre-existing `apps/mobile/lib/google-auth.ts` stub and remove any imports of it.

- [ ] **Step 1: Install expo-auth-session**

Run: `cd apps/mobile && npx expo install expo-auth-session expo-crypto`

- [ ] **Step 2: Create mobile OAuth flow module**

Create `apps/mobile/lib/google-oauth.ts`:

```typescript
import { Platform } from 'react-native';
import * as AuthSession from 'expo-auth-session';
import {
  generateCodeVerifier,
  buildAuthUrl,
  exchangeAuthCode,
  revokeToken as coreRevokeToken,
} from '@keykeykey/core/sync';

// TODO: Replace with actual GCP client IDs after setup
export const GOOGLE_DRIVE_CLIENT_ID_IOS = 'PLACEHOLDER_IOS_CLIENT_ID';
export const GOOGLE_DRIVE_CLIENT_ID_ANDROID = 'PLACEHOLDER_ANDROID_CLIENT_ID';

export function getClientId(): string {
  return Platform.OS === 'ios'
    ? GOOGLE_DRIVE_CLIENT_ID_IOS
    : GOOGLE_DRIVE_CLIENT_ID_ANDROID;
}

/**
 * Run the Google OAuth flow using expo-auth-session.
 *
 * Uses the system browser (ASWebAuthenticationSession on iOS,
 * Custom Tabs on Android) for secure OAuth.
 *
 * PKCE helpers are reused from @keykeykey/core/sync (generateCodeVerifier,
 * buildAuthUrl) — crypto.subtle is available in Hermes (React Native 0.76+).
 */
export async function startGoogleOAuth(): Promise<{ refreshToken: string }> {
  const clientId = getClientId();
  const redirectUri = AuthSession.makeRedirectUri();
  const codeVerifier = generateCodeVerifier();

  // Build auth URL using core helper (includes PKCE challenge, access_type=offline, prompt=consent)
  const authUrl = await buildAuthUrl({
    clientId,
    redirectUri,
    codeVerifier,
  });

  // Launch system browser
  const result = await AuthSession.startAsync({ authUrl, returnUrl: redirectUri });

  if (result.type !== 'success' || !result.params?.code) {
    throw new Error(
      result.type === 'cancel'
        ? 'Google sign-in was cancelled'
        : 'Google sign-in failed',
    );
  }

  // Exchange code for tokens
  const tokens = await exchangeAuthCode({
    code: result.params.code,
    clientId,
    redirectUri,
    codeVerifier,
  });

  return { refreshToken: tokens.refreshToken };
}

export const revokeToken = coreRevokeToken;
```

**Note:** If `crypto.subtle` is not available in the React Native runtime, fall back to `expo-crypto` for the SHA-256 digest. Test on both iOS and Android during manual verification. The core `generateCodeVerifier()` uses `crypto.getRandomValues` which is available in Hermes.

- [ ] **Step 3: Update provider list in sync.tsx**

In `apps/mobile/app/settings/sync.tsx`, replace the providers array (lines 198-203):

```typescript
  const providers: { id: SyncProvider; label: string; comingSoon?: boolean }[] = [
    { id: 'none', label: 'None (Local Only)' },
    { id: 'webdav', label: 'WebDAV' },
    { id: 'google-drive', label: 'Google Drive' },
    { id: 'icloud', label: 'iCloud (Coming Soon)', comingSoon: true },
  ];
```

- [ ] **Step 4: Add Google Drive connect handler and UI**

At the top of `sync.tsx`, add:

```typescript
import { startGoogleOAuth, revokeToken, getClientId, GOOGLE_DRIVE_CLIENT_ID_IOS, GOOGLE_DRIVE_CLIENT_ID_ANDROID } from '../../lib/google-oauth';
```

Add a Google Drive connect handler inside the component:

```typescript
  const handleGoogleConnect = async () => {
    if (!masterPassword) {
      setSyncError('Master password is required.');
      return;
    }
    setConnecting(true);
    setSyncError(null);
    try {
      const { refreshToken } = await startGoogleOAuth();
      const config: SyncConfig = {
        provider: 'google-drive',
        masterPassword,
        googleDrive: { refreshToken, clientId: getClientId() },
      };
      await saveSyncConfig(config);
      const result = await triggerSync();
      if (result.error) setSyncError(result.error);
      else setLastSynced(result.lastSynced);
      setMasterPassword('');
    } catch (e) {
      setSyncError(e instanceof Error ? e.message : 'Google sign-in failed');
    } finally {
      setConnecting(false);
    }
  };
```

In the render section, when `syncProvider === 'google-drive'` and not connected, show the master password field and a "Sign in with Google" button (same pattern as the WebDAV master password field + a connect button, but without WebDAV URL/credentials).

- [ ] **Step 5: Verify TypeScript compilation**

Run: `cd apps/mobile && npx tsc --noEmit`
Expected: No errors (or only pre-existing issues).

- [ ] **Step 6: Update mobile sync settings tests**

In `apps/mobile/__tests__/screens/sync-settings.test.tsx`:

Add a mock for the google-oauth module:

```typescript
jest.mock('../../lib/google-oauth', () => ({
  startGoogleOAuth: jest.fn(),
  revokeToken: jest.fn(),
  getClientId: jest.fn(() => 'test-ios-client-id'),
  GOOGLE_DRIVE_CLIENT_ID_IOS: 'test-ios',
  GOOGLE_DRIVE_CLIENT_ID_ANDROID: 'test-android',
}));
```

Update the "does not show coming soon banner" test if it references Google Drive. Add a test that Google Drive can be selected.

- [ ] **Step 7: Run mobile tests**

Run: `pnpm --filter @keykeykey/mobile test`
Expected: All tests pass.

- [ ] **Step 8: Commit**

```bash
git add apps/mobile/lib/google-oauth.ts apps/mobile/lib/google-auth.ts apps/mobile/app/settings/sync.tsx apps/mobile/package.json apps/mobile/__tests__/screens/sync-settings.test.tsx pnpm-lock.yaml
git commit -m "feat(mobile): add Google Drive OAuth flow and enable in sync settings UI"
```

Note: `google-auth.ts` is staged for deletion (git tracks the delete). The `pnpm-lock.yaml` is included because `expo-auth-session` was added as a dependency.

---

### Task 6: Extension — Manifest, OAuth Flow, and Background Messages

**Files:**

- Create: `apps/extension/src/lib/google-oauth.ts`
- Delete: `apps/extension/src/lib/google-auth.ts` (pre-existing stub, replaced by google-oauth.ts)
- Modify: `apps/extension/manifest.json:6`
- Modify: `apps/extension/src/lib/messages.ts:48-86`
- Modify: `apps/extension/src/background/message-handler.ts`
- Modify: `apps/extension/src/background/sync.ts`

**Note:** Delete the pre-existing `apps/extension/src/lib/google-auth.ts` stub and remove any imports of it.

- [ ] **Step 1: Add identity permission to manifest**

In `apps/extension/manifest.json`, change line 6:

```json
  "permissions": ["storage", "activeTab", "alarms", "windows", "offscreen", "tabs", "identity"],
```

- [ ] **Step 2: Create extension OAuth flow module**

Create `apps/extension/src/lib/google-oauth.ts`:

```typescript
import {
  generateCodeVerifier,
  buildAuthUrl,
  exchangeAuthCode,
  revokeToken as coreRevokeToken,
} from '@keykeykey/core/sync';

// TODO: Replace with actual GCP Web client ID after setup
export const GOOGLE_DRIVE_CLIENT_ID = 'PLACEHOLDER_EXTENSION_CLIENT_ID';

/**
 * Run the Google OAuth flow using browser.identity.launchWebAuthFlow.
 * Works across Chrome, Firefox, and Safari.
 */
export async function startGoogleOAuth(): Promise<{ refreshToken: string }> {
  const codeVerifier = generateCodeVerifier();

  // Get the browser-specific redirect URL
  const redirectUri = typeof browser !== 'undefined'
    ? browser.identity.getRedirectURL()
    : chrome.identity.getRedirectURL();

  const authUrl = await buildAuthUrl({
    clientId: GOOGLE_DRIVE_CLIENT_ID,
    redirectUri,
    codeVerifier,
  });

  // Launch the OAuth popup
  const launchWebAuthFlow = typeof browser !== 'undefined'
    ? browser.identity.launchWebAuthFlow
    : chrome.identity.launchWebAuthFlow;

  const callbackUrl = await new Promise<string>((resolve, reject) => {
    launchWebAuthFlow({ url: authUrl, interactive: true }, (responseUrl) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else if (!responseUrl) {
        reject(new Error('No response URL from OAuth flow'));
      } else {
        resolve(responseUrl);
      }
    });
  });

  // Extract auth code from callback URL
  const url = new URL(callbackUrl);
  const code = url.searchParams.get('code');
  if (!code) {
    throw new Error('No authorization code in OAuth redirect');
  }

  // Exchange for tokens
  const tokens = await exchangeAuthCode({
    code,
    clientId: GOOGLE_DRIVE_CLIENT_ID,
    redirectUri,
    codeVerifier,
  });

  return { refreshToken: tokens.refreshToken };
}

export const revokeToken = coreRevokeToken;
```

- [ ] **Step 3: Add new message types**

In `apps/extension/src/lib/messages.ts`, add to the `BackgroundMessage` union (before the closing `};` around line 86):

```typescript
  | { type: 'GOOGLE_OAUTH_CONNECT'; masterPassword: string }
  | { type: 'GOOGLE_OAUTH_DISCONNECT' }
```

- [ ] **Step 4: Add message handlers**

In `apps/extension/src/background/message-handler.ts`, add import at the top:

```typescript
import { startGoogleOAuth, revokeToken, GOOGLE_DRIVE_CLIENT_ID } from '../lib/google-oauth.js';
```

Add handlers in the switch statement (before the default case):

```typescript
    case 'GOOGLE_OAUTH_CONNECT': {
      if (sender?.tab) return { error: 'Not allowed from content scripts' };
      try {
        const { refreshToken } = await startGoogleOAuth();
        const config: SyncConfig = {
          provider: 'google-drive',
          masterPassword: message.masterPassword,
          googleDrive: { refreshToken, clientId: GOOGLE_DRIVE_CLIENT_ID },
        };
        const lc = getLifecycle();
        await lc.saveConfig(config);
        return { ok: true };
      } catch (err) {
        return { error: err instanceof Error ? err.message : 'Google sign-in failed' };
      }
    }

    case 'GOOGLE_OAUTH_DISCONNECT': {
      if (sender?.tab) return { error: 'Not allowed from content scripts' };
      try {
        // Best-effort token revocation
        // TODO: retrieve stored refresh token before revoking
        const lc = getLifecycle();
        await lc.saveConfig({ provider: 'none' });
        teardownLifecycle();
        await clearSyncConfig();
        return { ok: true };
      } catch (err) {
        return { error: err instanceof Error ? err.message : 'Disconnect failed' };
      }
    }
```

- [ ] **Step 5: Verify TypeScript compilation**

Run: `cd apps/extension && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 6: Commit**

Delete the old stub: `rm apps/extension/src/lib/google-auth.ts`

```bash
git add apps/extension/manifest.json apps/extension/src/lib/google-oauth.ts apps/extension/src/lib/google-auth.ts apps/extension/src/lib/messages.ts apps/extension/src/background/message-handler.ts
git commit -m "feat(extension): add Google Drive OAuth flow, identity permission, and message handlers"
```

---

### Task 7: Extension — Sync Settings UI Update

**Files:**

- Modify: `apps/extension/src/popup/screens/SyncSettingsScreen.tsx:403-405`

- [ ] **Step 1: Enable Google Drive option**

In `apps/extension/src/popup/screens/SyncSettingsScreen.tsx`, replace (around line 403):

```html
              <option value="google-drive" disabled>
                Google Drive (Coming Soon)
              </option>
```

with:

```html
              <option value="google-drive">Google Drive</option>
```

- [ ] **Step 2: Add Google Drive connect UI**

When `syncProvider === 'google-drive'` and not connected, show master password field + "Sign in with Google" button. The button sends a `GOOGLE_OAUTH_CONNECT` message to the background:

```tsx
      {syncProvider === 'google-drive' && !syncStatus?.provider?.match(/google/) && (
        <>
          <div style={fieldStyle}>
            <label style={labelStyle}>Master Password</label>
            <div style={{ display: 'flex', gap: theme.spacing.xs }}>
              <input
                type={showMasterPassword ? 'text' : 'password'}
                value={masterPassword}
                onChange={(e) => setMasterPassword(e.target.value)}
                placeholder="Required for sync encryption"
                data-testid="sync-master-password"
                style={{ ...inputStyle, flex: 1 }}
              />
              <button
                onClick={() => setShowMasterPassword(!showMasterPassword)}
                style={eyeButtonStyle}
                type="button"
              >
                {showMasterPassword ? <EyeOffIcon size={16} /> : <EyeIcon size={16} />}
              </button>
            </div>
          </div>
          <button
            onClick={async () => {
              if (!masterPassword) {
                setError('Master password is required.');
                return;
              }
              setConnecting(true);
              setError(null);
              try {
                const result = await sendMessage<{ ok?: boolean; error?: string }>({
                  type: 'GOOGLE_OAUTH_CONNECT',
                  masterPassword,
                });
                if (result?.error) {
                  setError(result.error);
                } else {
                  // Trigger sync and refresh status
                  await sendMessage({ type: 'TRIGGER_SYNC' });
                  const status = await sendMessage<SyncStatus>({ type: 'GET_SYNC_STATUS' });
                  setSyncStatus(status);
                  setMasterPassword('');
                }
              } catch {
                setError('Google sign-in failed.');
              } finally {
                setConnecting(false);
              }
            }}
            disabled={connecting || !masterPassword}
            style={{
              ...connectButtonStyle,
              opacity: connecting || !masterPassword ? 0.6 : 1,
            }}
          >
            {connecting ? 'Signing in…' : 'Sign in with Google'}
          </button>
        </>
      )}
```

- [ ] **Step 3: Verify TypeScript compilation**

Run: `cd apps/extension && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 4: Update extension tests**

In `apps/extension/src/popup/screens/SyncSettingsScreen.test.tsx`, add a mock for the google-oauth module and update any tests that check for "Coming Soon" text on Google Drive. Add a test that verifies the "Sign in with Google" button appears when Google Drive is selected.

- [ ] **Step 5: Run extension tests**

Run: `pnpm --filter @keykeykey/extension test`
Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add apps/extension/src/popup/screens/SyncSettingsScreen.tsx apps/extension/src/popup/screens/SyncSettingsScreen.test.tsx
git commit -m "feat(extension): enable Google Drive in sync settings UI"
```

---

### Task 8: Final Verification

- [ ] **Step 1: Build all packages**

Run: `pnpm build`
Expected: Build succeeds.

- [ ] **Step 2: Run all tests**

Run: `pnpm test`
Expected: All tests pass.

- [ ] **Step 3: Run lint**

Run: `pnpm lint`
Expected: No new lint errors.

- [ ] **Step 4: Run E2E critical tests**

Run: `cd e2e && npx playwright test --grep @critical`
Expected: All critical tests pass.

- [ ] **Step 5: Manual verification checklist**

After setting up real GCP client IDs (see spec doc for setup guide):

- Desktop: Select "Google Drive" → "Sign in with Google" → browser opens Google consent → redirect back → connected state shows
- Desktop: Disconnect → provider resets to None
- Mobile (iOS): Select Google Drive → system browser opens → consent → connected
- Mobile (Android): Same flow
- Extension (Chrome): Select Google Drive → popup OAuth flow → connected
- Extension (Firefox): Same flow
- Extension (Safari): Same flow
- All platforms: After connecting, "Sync Now" works
- All platforms: Vault data appears in Google Drive appDataFolder
- All platforms: Wrong password on unlock after sync shows appropriate error
