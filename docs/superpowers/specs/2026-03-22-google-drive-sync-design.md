# Google Drive Sync — Design Spec

**Date:** 2026-03-22
**Goal:** Enable Google Drive as a sync provider across all platforms (desktop, mobile, browser extension) using the existing `GoogleDriveAdapter` and sync infrastructure.

---

## Context

The core `GoogleDriveAdapter` already exists (`packages/core/src/sync/google-drive-adapter.ts`) and uses Google Drive's `appDataFolder` scope — a hidden, app-private folder in the user's own Drive. The adapter delegates OAuth via a `getAccessToken: () => Promise<string>` callback, making it platform-agnostic.

The `SyncConfig` type already includes `'google-drive'` as a provider and `googleDrive?: { refreshToken }`. The `createAdapterFromConfig` factory handles Google Drive. All UIs currently show Google Drive as "coming soon" / disabled.

What's missing: OAuth flows per platform, token refresh wiring, UI enablement, and GCP project setup.

---

## Architecture

### OAuth Model

All platforms act as **public OAuth 2.0 clients** (no client secret). Google allows this for `drive.appdata` scope. Security relies on:

- **PKCE (S256)** — proof of authorization request origin
- **Redirect URI validation** — Google only sends auth codes to registered URIs
- **Refresh token storage** — encrypted inside `SyncConfig` (XChaCha20-Poly1305 with DEK)

### Token Flow

```
User clicks "Sign in with Google"
  → Platform opens Google consent screen (browser/popup/system browser)
  → User approves
  → Google redirects with auth code
  → Platform extracts auth code
  → Core exchanges code for { access_token, refresh_token } via POST to token endpoint
  → refresh_token saved in encrypted SyncConfig
  → GoogleDriveAdapter.getAccessToken callback calls core's refreshAccessToken()
  → Sync proceeds as normal (same engine as WebDAV)
```

### Data Storage

All sync data lives in the **user's own Google Drive** in the `appDataFolder`. No KeyKeyKey account or server is involved. File layout (managed by existing `GoogleDriveAdapter`):

- `vault.enc` — encrypted vault blob (manifest + header)
- `items/{id}.bin` — individual encrypted vault items

### CORS (Desktop)

Unlike WebDAV (which requires a Rust HTTP proxy to bypass CORS), the Google Drive REST API returns `Access-Control-Allow-Origin: *` for authenticated requests. The `GoogleDriveAdapter` can use `fetch()` directly from the Tauri webview without routing through the proxy. This is verified: Google's API endpoints (`www.googleapis.com`, `oauth2.googleapis.com`) support CORS with OAuth bearer tokens.

### State Parameter (CSRF Prevention)

All platform flows generate a cryptographically random `state` parameter (32 bytes, base64url-encoded) and verify it in the redirect callback:

- **Desktop:** State is passed to `start_google_oauth()`, the Rust server extracts it from the redirect and returns it alongside the code. The frontend verifies `returnedState === sentState` before proceeding.
- **Mobile:** `expo-auth-session` handles state generation and verification automatically.
- **Extension:** State is generated before calling `launchWebAuthFlow`, verified by parsing the redirect URL.

---

## Component Design

### 1. Core: `google-oauth.ts`

**New file:** `packages/core/src/sync/google-oauth.ts`

Platform-agnostic OAuth token operations. All functions are pure (fetch-based, no platform deps).

```typescript
// PKCE helpers
generateCodeVerifier(): string        // 43-128 char random string (RFC 7636)
generateCodeChallenge(verifier): Promise<string>  // SHA-256 → base64url

// URL construction
buildAuthUrl(params: {
  clientId: string;
  redirectUri: string;
  codeVerifier: string;
  scope?: string;           // defaults to 'https://www.googleapis.com/auth/drive.appdata'
  loginHint?: string;       // pre-fill email
  prompt?: string;          // defaults to 'consent' (ensures refresh token is always returned)
}): Promise<{ url: string; codeVerifier: string }>
// Always includes access_type=offline and prompt=consent in the URL.
// access_type=offline is required for Google to return a refresh_token.
// prompt=consent ensures a refresh_token is returned on re-authorization.

// Token operations
exchangeAuthCode(params: {
  code: string;
  clientId: string;
  redirectUri: string;
  codeVerifier: string;
}): Promise<{ accessToken: string; refreshToken: string; expiresIn: number }>

refreshAccessToken(params: {
  refreshToken: string;
  clientId: string;
}): Promise<{ accessToken: string; expiresIn: number }>

revokeToken(token: string): Promise<void>
```

**Endpoints used:**

- Auth: `https://accounts.google.com/o/oauth2/v2/auth`
- Token: `https://oauth2.googleapis.com/token`
- Revoke: `https://oauth2.googleapis.com/revoke`

**Error handling:** Token endpoint errors throw a typed `GoogleOAuthError` with `error` and `error_description` fields from Google's response. When `refreshAccessToken` receives an `invalid_grant` error (token revoked or expired), it throws `SyncAuthError` which surfaces to the user as "Google Drive disconnected — sign in again" and auto-disconnects.

### Access Token Caching

Each platform's `getAccessToken` callback wraps `refreshAccessToken` with an **in-memory cache**:

```typescript
function createCachedTokenProvider(refreshToken: string, clientId: string) {
  let cached: { accessToken: string; expiresAt: number } | null = null;

  return async (): Promise<string> => {
    // Refresh if no cache or within 60s of expiry
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
```

This is defined in `google-oauth.ts` in core and used by `createAdapterFromConfig`. A single sync cycle (which may involve 10+ API calls) reuses the same access token instead of refreshing per-call. Tokens are refreshed 60 seconds before expiry to avoid mid-request failures.

### 2. SyncConfig Schema Update

**File:** `packages/core/src/sync/sync-config.ts`

Expand the `googleDrive` field:

```typescript
googleDrive: z.object({
  refreshToken: z.string(),
  clientId: z.string(),
}).optional(),
```

Adding `clientId` so that `refreshAccessToken` knows which client to use — each platform has a different OAuth client ID registered in GCP.

**`createAdapterFromConfig` update:** Replace the existing google-drive case. The current code has two paths: a `__chrome_managed__` sentinel for Chrome-managed tokens and a `platform.getAccessToken` callback. Both are replaced with the unified `createCachedTokenProvider` from `google-oauth.ts`:

```typescript
case 'google-drive': {
  const { refreshToken, clientId } = config.googleDrive!;
  return new GoogleDriveAdapter({
    getAccessToken: createCachedTokenProvider(refreshToken, clientId),
  });
}
```

The `AdapterPlatformCallbacks.getAccessToken` callback and `getChromeAccessToken` sentinel are removed — token refresh is now handled entirely by core using the stored refresh token + client ID. This simplifies the platform interface.

**Backward compatibility:** Since Google Drive is currently disabled in all UIs (no user has a persisted google-drive config), making `clientId` required is safe. No migration needed.

### 3. Desktop (Tauri) — Loopback OAuth

**New file:** `apps/desktop/src-tauri/src/oauth_server.rs`

A one-shot Rust HTTP server for the loopback redirect:

```
1. Bind to http://127.0.0.1:0 (OS picks port)
2. Return port to frontend via Tauri command
3. Accept single GET request from Google's redirect
4. Extract `code` and `state` query parameters
5. Respond with HTML: "Sign-in complete. You can close this tab."
6. Shut down, return auth code to frontend
```

**New Tauri commands:**

- `start_google_oauth(state_param: String) -> u16` — starts server, returns port
- `await_google_oauth_code() -> Result<String, String>` — waits for redirect, returns auth code (with 120s timeout)

**New frontend file:** `apps/desktop/src/lib/google-oauth.ts`

```typescript
export const GOOGLE_DRIVE_CLIENT_ID = '<desktop-client-id>'; // from GCP

export async function startGoogleOAuth(): Promise<{ refreshToken: string }> {
  // 1. Generate PKCE verifier + challenge
  // 2. invoke('start_google_oauth', { stateParam }) → port
  // 3. buildAuthUrl({ clientId, redirectUri: `http://127.0.0.1:${port}`, codeVerifier })
  // 4. shell.open(authUrl)
  // 5. invoke('await_google_oauth_code') → code
  // 6. exchangeAuthCode({ code, clientId, redirectUri, codeVerifier }) → tokens
  // 7. return { refreshToken }
}
```

**SyncSettingsScreen update** (`apps/desktop/src/screens/SyncSettingsScreen.tsx`):

- Remove `disabled` from Google Drive option in provider select
- When provider is `'google-drive'` and not connected: show "Sign in with Google" button + master password field
- On click: call `startGoogleOAuth()`, then save config with `{ provider: 'google-drive', masterPassword, googleDrive: { refreshToken, clientId } }`
- When connected: show "Connected via Google Drive" status with Disconnect button
- Disconnect: call `revokeToken`, save `{ provider: 'none' }`

### 4. Mobile (Expo) — expo-auth-session

**New dependency:** `expo-auth-session` (+ `expo-crypto` for PKCE if not already present)

**New file:** `apps/mobile/lib/google-oauth.ts`

```typescript
import * as AuthSession from 'expo-auth-session';
import {
  exchangeAuthCode,
  generateCodeVerifier,
  generateCodeChallenge,
} from '@keykeykey/core/sync';

export const GOOGLE_DRIVE_CLIENT_ID_IOS = '<ios-client-id>';
export const GOOGLE_DRIVE_CLIENT_ID_ANDROID = '<android-client-id>';

export function getClientId(): string {
  return Platform.OS === 'ios' ? GOOGLE_DRIVE_CLIENT_ID_IOS : GOOGLE_DRIVE_CLIENT_ID_ANDROID;
}

export async function startGoogleOAuth(): Promise<{ refreshToken: string }> {
  // 1. Generate PKCE verifier + challenge
  // 2. Build auth URL
  // 3. Use AuthSession.useAuthRequest() hook (startAsync is deprecated)
  // 4. Extract code from response
  // 5. exchangeAuthCode() → tokens
  // 6. return { refreshToken }
}
```

**Redirect URI:** `AuthSession.makeRedirectUri()` — generates the correct scheme per platform.

**Sync settings UI update** (`apps/mobile/app/settings/sync.tsx`):

- Remove `comingSoon: true` from Google Drive option
- Same UI pattern: "Sign in with Google" button + master password when google-drive selected
- Connected/disconnect state

### 5. Browser Extension — identity.launchWebAuthFlow

**New file:** `apps/extension/src/lib/google-oauth.ts`

```typescript
export const GOOGLE_DRIVE_CLIENT_ID = '<web-client-id>';

export async function startGoogleOAuth(): Promise<{ refreshToken: string }> {
  // 1. Generate PKCE verifier + challenge
  // 2. redirectUri = browser.identity.getRedirectURL()
  // 3. buildAuthUrl({ clientId, redirectUri, codeVerifier })
  // 4. browser.identity.launchWebAuthFlow({ url, interactive: true }) → redirectUrl
  // 5. Extract code from redirectUrl
  // 6. exchangeAuthCode({ code, clientId, redirectUri, codeVerifier }) → tokens
  // 7. return { refreshToken }
}
```

**Browser compatibility:** `browser.identity.launchWebAuthFlow` works on Chrome, Firefox, and Safari. Use the `webextension-polyfill` or feature-detect `browser` vs `chrome` namespace.

**New message types in `message-handler.ts`:**

- `GOOGLE_OAUTH_CONNECT` — triggers `startGoogleOAuth()` from background, saves config, returns `{ ok: true }`
- `GOOGLE_OAUTH_DISCONNECT` — calls `revokeToken`, clears config, returns `{ ok: true }`

The OAuth must run in the background script because `browser.identity` is a background API.

**SyncSettingsScreen update** (`apps/extension/src/popup/screens/SyncSettingsScreen.tsx`):

- Remove `disabled` from Google Drive option
- "Sign in with Google" button sends `GOOGLE_OAUTH_CONNECT` message
- Connected state with disconnect button sends `GOOGLE_OAUTH_DISCONNECT`

---

## GCP Project Setup

Detailed steps for setting up Google Cloud OAuth (all free, no billing required):

### Step 1: Create Project

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Click project selector → "New Project"
3. Name: "KeyKeyKey", no organization needed
4. Click "Create"

### Step 2: Enable Google Drive API

1. Go to "APIs & Services" → "Library"
2. Search "Google Drive API"
3. Click "Enable"

### Step 3: Configure OAuth Consent Screen

1. Go to "APIs & Services" → "OAuth consent screen"
2. Choose "External" user type
3. Fill in:
   - App name: "KeyKeyKey"
   - User support email: your email
   - Developer contact: your email
4. Add scope: `https://www.googleapis.com/auth/drive.appdata`
5. No test users needed initially (you can add them later)
6. Save

### Step 4: Create OAuth Client IDs

Go to "APIs & Services" → "Credentials" → "Create Credentials" → "OAuth client ID"

**Desktop client:**

- Application type: "Desktop app"
- Name: "KeyKeyKey Desktop"
- No redirect URIs needed (loopback is automatic for desktop type)

**Web client (for browser extensions):**

- Application type: "Web application"
- Name: "KeyKeyKey Extension"
- Authorized redirect URIs: add the redirect URLs for each browser
  - Chrome: `https://<extension-id>.chromiumapp.org/` (get ID from `chrome://extensions`)
  - Firefox: `https://<uuid>.extensions.allizom.org/` (get from `browser.identity.getRedirectURL()`)
  - Safari: determined at runtime

**iOS client:**

- Application type: "iOS"
- Name: "KeyKeyKey iOS"
- Bundle ID: `com.keykeykey.app`

**Android client:**

- Application type: "Android"
- Name: "KeyKeyKey Android"
- Package name: `com.keykeykey.app`
- SHA-1 signing certificate: from `keytool -list -v -keystore ~/.android/debug.keystore` (debug builds). For release builds, also add the SHA-1 from the release signing key.

### Step 5: Note Client IDs

Each client gets a client ID like `123456789.apps.googleusercontent.com`. Record each one — they go into `.env` files (never committed to git):

- Desktop: `apps/desktop/.env` → `VITE_GOOGLE_CLIENT_ID`, `VITE_GOOGLE_CLIENT_SECRET`
- Mobile: `apps/mobile/.env` → `EXPO_PUBLIC_GOOGLE_CLIENT_ID_IOS`, `EXPO_PUBLIC_GOOGLE_CLIENT_ID_ANDROID`
- Extension: `apps/extension/.env` → `VITE_GOOGLE_CLIENT_ID_CHROME`, `VITE_GOOGLE_CLIENT_ID_SAFARI`, `VITE_GOOGLE_CLIENT_ID_FIREFOX`

### Verification (Optional, for Distribution)

Until verified, the app shows an "unverified app" warning. To verify:

1. Add a privacy policy URL
2. Submit for Google review (free, takes a few days)
3. Only needed when distributing to external users

---

## Testing Strategy

### Core Unit Tests

- `google-oauth.test.ts`: Mock `fetch`, test all token operations, PKCE generation, error handling
- `sync-config.test.ts`: Test `createAdapterFromConfig` with google-drive config

### Desktop Tests

- Mock Tauri `invoke` commands (`start_google_oauth`, `await_google_oauth_code`)
- Mock `shell.open`
- Test OAuth flow orchestration end-to-end with mocks
- Test SyncSettingsScreen renders Google Drive option and connect/disconnect UI

### Mobile Tests

- Mock `expo-auth-session`
- Test OAuth flow orchestration
- Test sync settings screen with Google Drive selection

### Extension Tests

- Mock `browser.identity.launchWebAuthFlow`
- Test `GOOGLE_OAUTH_CONNECT` and `GOOGLE_OAUTH_DISCONNECT` message handlers
- Test SyncSettingsScreen Google Drive UI states

### E2E Tests

Full OAuth flow can't be automated (requires real Google sign-in). E2E tests cover:

- Provider selection shows Google Drive as enabled
- Selecting Google Drive shows "Sign in with Google" button
- Connected/disconnected state rendering

---

## Security Considerations

1. **No client secret** — all platforms are public clients. Security via PKCE + redirect URI validation.
2. **Refresh token encrypted** — stored in `SyncConfig` which is XChaCha20-Poly1305 encrypted with the DEK.
3. **Token revocation on disconnect** — `revokeToken()` called before clearing config.
4. **Scope minimization** — only `drive.appdata` requested. Cannot access user's visible Drive files.
5. **SSRF protection** — desktop's Rust proxy already blocks private IPs; Google API calls go to `googleapis.com` directly via CORS.
6. **State parameter** — cryptographically random state parameter generated and verified on all platforms to prevent CSRF (see Architecture section).
7. **Shell open URL validation** — desktop's `shell.open()` call validates the URL starts with `https://accounts.google.com/` before opening to prevent arbitrary URL opening from a compromised frontend.
8. **Auth failure recovery** — when a refresh token is revoked server-side or expires (6 months inactive), `SyncAuthError` triggers auto-disconnect with a user-facing message to re-authenticate. Prevents silent sync failures.

---

## Files Changed Summary

### New Files

| File                                          | Purpose                                               |
| --------------------------------------------- | ----------------------------------------------------- |
| `packages/core/src/sync/google-oauth.ts`      | OAuth token helpers (exchange, refresh, PKCE, revoke) |
| `packages/core/src/sync/google-oauth.test.ts` | Unit tests for OAuth helpers                          |
| `apps/desktop/src-tauri/src/oauth_server.rs`  | Rust one-shot loopback HTTP server                    |
| `apps/desktop/src/lib/google-oauth.ts`        | Desktop OAuth flow orchestration                      |
| `apps/mobile/lib/google-oauth.ts`             | Mobile OAuth flow orchestration                       |
| `apps/extension/src/lib/google-oauth.ts`      | Extension OAuth flow orchestration                    |

### Modified Files

| File                                                      | Change                                                                                                                           |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `packages/core/src/sync/sync-config.ts`                   | Add `clientId` to googleDrive schema, update adapter factory, remove `getAccessToken` callback and `__chrome_managed__` sentinel |
| `packages/core/src/sync/sync-config.test.ts`              | Test google-drive adapter creation                                                                                               |
| `packages/core/src/sync/index.ts`                         | Export new `google-oauth` module                                                                                                 |
| `apps/desktop/src-tauri/src/lib.rs`                       | Wire oauth_server module and register Tauri commands                                                                             |
| `apps/desktop/src-tauri/Cargo.toml`                       | Add deps if needed (likely just `tokio` already present)                                                                         |
| `apps/desktop/src/screens/SyncSettingsScreen.tsx`         | Enable Google Drive, add OAuth UI                                                                                                |
| `apps/mobile/app/settings/sync.tsx`                       | Enable Google Drive, add OAuth UI                                                                                                |
| `apps/mobile/package.json`                                | Add `expo-auth-session` dependency                                                                                               |
| `apps/extension/manifest.json`                            | Add `"identity"` permission                                                                                                      |
| `apps/extension/src/popup/screens/SyncSettingsScreen.tsx` | Enable Google Drive, add OAuth UI                                                                                                |
| `apps/extension/src/background/message-handler.ts`        | Add `GOOGLE_OAUTH_CONNECT` / `GOOGLE_OAUTH_DISCONNECT` handlers                                                                  |
| `apps/extension/src/background/sync.ts`                   | Add google OAuth helper functions                                                                                                |
| `apps/extension/src/lib/messages.ts`                      | Add new message types                                                                                                            |
