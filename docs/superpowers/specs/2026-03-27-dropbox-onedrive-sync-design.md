# Dropbox & OneDrive Sync + iCloud Removal

**Date:** 2026-03-27
**Status:** Approved

## Overview

Remove all iCloud sync references from the project and add Dropbox and OneDrive as new sync providers. Both use OAuth2 PKCE and REST APIs with app-specific folder support. The existing Google OAuth module is refactored into a generic OAuth layer shared by all three OAuth-based providers.

After this work, the supported sync providers are: **None, WebDAV, Google Drive, Dropbox, OneDrive**.

## 1. iCloud Removal

### Files to delete
- `packages/core/src/sync/icloud-adapter.ts`
- `packages/core/src/sync/icloud-adapter.test.ts`

### Files to modify

**Core (`packages/core`):**
- `sync-config.ts`: Remove `'icloud'` from `SyncProvider` union, remove `icloud` field from `SyncConfigSchema`, remove `ICloudAdapter` import and `case 'icloud'` from `createAdapterFromConfig()`, remove `ICloudFs` from `AdapterPlatformCallbacks`, remove `APPLE_PLATFORMS` constant and platform-gating in `getAvailableProviders()`
- `sync/index.ts`: Remove iCloud exports

**Desktop (`apps/desktop`):**
- `SyncSettingsScreen.tsx`: Remove "iCloud (Coming Soon)" option
- `RestoreScreen.tsx`: Remove iCloud option
- `SettingsScreen.tsx`: Remove iCloud status text
- `SyncSettingsScreen.test.tsx`: Remove iCloud test cases

**Mobile (`apps/mobile`):**
- `app/settings/sync.tsx`: Remove iCloud option
- `app/(tabs)/settings.tsx`: Remove iCloud status text
- `__tests__/screens/sync-settings.test.tsx`: Remove iCloud test cases

**Extension (`apps/extension`):**
- `src/popup/screens/SyncSettingsScreen.tsx`: Remove iCloud option
- `src/popup/screens/RestoreScreen.tsx`: Remove iCloud option

**Do NOT modify** `import.tsx` / `ImportScreen.tsx` files — they reference "iCloud Keychain" for CSV import from Apple's password manager, which is unrelated to sync and must be kept.

**Verified clean:** `sync-lifecycle.ts` contains no iCloud references.
**Also update:** `packages/core/src/sync/types.ts` — update doc comment listing supported adapters (currently mentions iCloud).

## 2. Generic OAuth Module

### New file: `packages/core/src/sync/oauth.ts`

Extracts provider-agnostic OAuth2 PKCE logic from `google-oauth.ts`:

```typescript
// Types
export interface OAuthEndpoints {
  authEndpoint: string;
  tokenEndpoint: string;
  revokeEndpoint?: string; // optional (OneDrive lacks one)
}

export interface BuildAuthUrlParams {
  endpoints: OAuthEndpoints;
  clientId: string;
  redirectUri: string;
  codeVerifier: string;
  scope?: string;
  state?: string;
  extraParams?: Record<string, string>; // e.g. Dropbox's token_access_type
}

export interface ExchangeAuthCodeParams {
  tokenEndpoint: string;
  code: string;
  clientId: string;
  redirectUri: string;
  codeVerifier: string;
  clientSecret?: string;
}

export interface RefreshParams {
  tokenEndpoint: string;
  refreshToken: string;
  clientId: string;
  clientSecret?: string;
}

// Shared implementations
export class OAuthError extends Error { ... }
export function generateCodeVerifier(): string { ... }
export async function generateCodeChallenge(verifier: string): Promise<string> { ... }
export async function buildAuthUrl(params: BuildAuthUrlParams): Promise<string> { ... }
export async function exchangeAuthCode(params: ExchangeAuthCodeParams): Promise<TokenResponse> { ... }
export async function refreshAccessToken(params: RefreshParams): Promise<RefreshResponse> { ... }
export async function revokeToken(
  revokeEndpoint: string, token: string, style?: 'body' | 'bearer'
): Promise<void> { ... }
// style='body' (default, Google): POST with token in form body
// style='bearer' (Dropbox): POST with empty body, Authorization: Bearer header
export function createCachedTokenProvider(
  tokenEndpoint: string, refreshToken: string, clientId: string, clientSecret?: string
): () => Promise<string> { ... }
```

### Slimmed: `packages/core/src/sync/google-oauth.ts`

Becomes a thin wrapper re-exporting with Google-specific constants pre-filled:

```typescript
import { OAuthError, buildAuthUrl as genericBuildAuthUrl, ... } from './oauth.js';

export const GOOGLE_ENDPOINTS: OAuthEndpoints = {
  authEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenEndpoint: 'https://oauth2.googleapis.com/token',
  revokeEndpoint: 'https://oauth2.googleapis.com/revoke',
};
const GOOGLE_DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';

// Re-export wrapped helpers (existing call signatures preserved)
export async function buildAuthUrl(params) { ... }
export async function exchangeAuthCode(params) { ... }
export async function refreshAccessToken(params) { ... }
export function createCachedTokenProvider(refreshToken, clientId, clientSecret?) { ... }
export { revokeToken } from './oauth.js'; // with endpoint pre-filled

// Backwards compat
export { OAuthError as GoogleOAuthError };
```

**No breaking changes** to existing imports.

## 3. Dropbox Adapter

### New file: `packages/core/src/sync/dropbox-adapter.ts`

Implements `ISyncAdapter` using Dropbox API v2.

**File layout** (inside app-scoped folder `Apps/KeyKeyKey/`):
```
/vault.enc            — encrypted vault blob
/items/{id}.bin       — encrypted vault items
```

**API operations:**
| Operation | Endpoint | Method |
|-----------|----------|--------|
| Upload file | `https://content.dropboxapi.com/2/files/upload` | POST, binary body, metadata in `Dropbox-API-Arg` header, `mode: overwrite` |
| Download file | `https://content.dropboxapi.com/2/files/download` | POST, path in `Dropbox-API-Arg` header, content in response body |
| Delete file | `https://api.dropboxapi.com/2/files/delete_v2` | POST, JSON body `{ path }` |
| List folder | `https://api.dropboxapi.com/2/files/list_folder` | POST, JSON body `{ path }` |

**Design notes:**
- Path-based API — no file ID caching needed (simpler than Google Drive)
- Upload uses `mode: "overwrite"` for idempotent writes
- `getAccessToken` callback injected (same pattern as Google Drive)
- `checkAuth()` throws `SyncAuthError` on 401
- All paths are lowercase and prefixed with `/` (Dropbox convention)
- **Pagination:** `list_folder` may return `has_more: true` with a cursor. `listItems()` must loop calling `/2/files/list_folder/continue` until `has_more` is false to collect all items.

### New file: `packages/core/src/sync/dropbox-oauth.ts`

```typescript
export const DROPBOX_ENDPOINTS: OAuthEndpoints = {
  authEndpoint: 'https://www.dropbox.com/oauth2/authorize',
  tokenEndpoint: 'https://api.dropboxapi.com/oauth2/token',
  revokeEndpoint: 'https://api.dropboxapi.com/2/auth/token/revoke',
};

// Extra param: token_access_type=offline (required for refresh tokens)
// No scope parameter needed (app folder access configured at registration)
```

## 4. OneDrive Adapter

### New file: `packages/core/src/sync/onedrive-adapter.ts`

Implements `ISyncAdapter` using Microsoft Graph API.

**File layout** (inside hidden `approot` special folder):
```
approot:/vault.enc            — encrypted vault blob
approot:/items/{id}.bin       — encrypted vault items
```

**API operations:**
| Operation | Endpoint | Method |
|-----------|----------|--------|
| Upload file | `https://graph.microsoft.com/v1.0/me/drive/special/approot:/{path}:/content` | PUT, binary body |
| Download file | Same URL | GET |
| Delete file | `https://graph.microsoft.com/v1.0/me/drive/special/approot:/{path}:` | DELETE |
| List folder | `https://graph.microsoft.com/v1.0/me/drive/special/approot:/{path}:/children` | GET |

**Design notes:**
- Path-based API using `approot:` special folder syntax
- Simple PUT for upload (no multipart, no special headers)
- Content-Type: `application/octet-stream` for uploads
- `getAccessToken` callback injected
- `checkAuth()` throws `SyncAuthError` on 401/403
- List children returns `{ value: [{ name }] }` — filter for `.bin` suffix
- **Pagination:** Graph API returns `@odata.nextLink` when results are paginated. `listItems()` must follow next links until exhausted.
- **Upload size limit:** Simple PUT supports up to 4MB (more than sufficient for vault data — blobs are typically <100KB).

### New file: `packages/core/src/sync/onedrive-oauth.ts`

```typescript
export const ONEDRIVE_ENDPOINTS: OAuthEndpoints = {
  authEndpoint: 'https://login.microsoftonline.com/consumers/oauth2/v2/authorize',
  tokenEndpoint: 'https://login.microsoftonline.com/consumers/oauth2/v2/token',
  // No simple revoke endpoint — omitted
};
const ONEDRIVE_SCOPE = 'Files.ReadWrite.AppFolder offline_access';
```

## 5. Config & Wiring

### `packages/core/src/sync/sync-config.ts`

```typescript
export type SyncProvider = 'none' | 'webdav' | 'google-drive' | 'dropbox' | 'onedrive';

const SyncConfigSchema = z.object({
  provider: z.enum(['none', 'webdav', 'google-drive', 'dropbox', 'onedrive']),
  masterPassword: z.string().optional(),
  webdav: z.object({ url, username, password }).optional(),
  googleDrive: z.object({ refreshToken, clientId, clientSecret? }).optional(),
  dropbox: z.object({ refreshToken: z.string(), clientId: z.string() }).optional(),
  onedrive: z.object({ refreshToken: z.string(), clientId: z.string() }).optional(),
});
```

`createAdapterFromConfig()` adds cases for `'dropbox'` and `'onedrive'`, creating the adapter with `createCachedTokenProvider` from respective OAuth modules.

`getAvailableProviders()`: Returns all five providers for all platforms (no platform-gating). Remove `platform` parameter. **Breaking change** — all call sites that pass a platform argument must be updated:
- `apps/desktop/src/screens/SyncSettingsScreen.tsx`
- `apps/desktop/src/screens/RestoreScreen.tsx`
- `apps/mobile/app/settings/sync.tsx`
- `apps/extension/src/popup/screens/SyncSettingsScreen.tsx`
- `apps/extension/src/popup/screens/RestoreScreen.tsx`
- Any test files that call `getAvailableProviders()`

`AdapterPlatformCallbacks`: Remove `icloudFs` field. No new platform callbacks needed (Dropbox/OneDrive are pure HTTP like Google Drive).

### Per-platform OAuth files (new, one per provider per app)

| App | Files |
|-----|-------|
| Desktop | `src/lib/dropbox-oauth.ts`, `src/lib/onedrive-oauth.ts` |
| Mobile | `lib/dropbox-oauth.ts`, `lib/onedrive-oauth.ts` |
| Extension | `src/lib/dropbox-oauth.ts`, `src/lib/onedrive-oauth.ts` |

Each follows the existing pattern from the corresponding `google-oauth.ts`:
- Desktop: Tauri `start_oauth` command + `open` for browser redirect
- Mobile: `expo-auth-session`
- Extension: `browser.identity.launchWebAuthFlow`

### Tauri backend

The existing `start_google_oauth` / `await_google_oauth_code` Rust commands are provider-agnostic (they just spin up a localhost HTTP server to receive the OAuth callback). **Rename** to `start_oauth` / `await_oauth_code` — the implementation in `oauth_server.rs` is already generic, and having Dropbox/OneDrive call `start_google_oauth` would be confusing. Update the desktop `google-oauth.ts` call sites to use the new command names.

### UI changes

All three apps' sync settings screens:
- Add "Dropbox" and "OneDrive" to provider selector dropdown
- Add OAuth connect buttons for each (same UX pattern as Google Drive)
- Show connected state with provider name

## 6. Testing

### Core tests

| Test file | Coverage |
|-----------|----------|
| `oauth.test.ts` | PKCE generation, code challenge, token exchange, refresh, caching, error handling (migrated from google-oauth tests) |
| `google-oauth.test.ts` | Verify Google-specific constants and wrapped helpers pass correct endpoints |
| `dropbox-adapter.test.ts` | Mock fetch, verify API calls/headers/paths for all ISyncAdapter methods, auth errors |
| `dropbox-oauth.test.ts` | Verify Dropbox-specific constants |
| `onedrive-adapter.test.ts` | Mock fetch, verify Graph API calls/paths, auth errors |
| `onedrive-oauth.test.ts` | Verify OneDrive-specific constants |
| `sync-config.test.ts` | Update: remove iCloud cases, add Dropbox/OneDrive for createAdapterFromConfig, config encrypt/decrypt |

### App tests
- Sync settings tests: remove iCloud assertions, add Dropbox/OneDrive options
- Platform OAuth tests per provider

### E2E
- No new e2e tests — sync e2e requires real cloud accounts and is tested manually.

## 7. Document Updates

- `implementationplan.md`: Replace iCloud with Dropbox/OneDrive in sync strategy
- `CLAUDE.md`: Update sync provider list, remove APPLE_PLATFORMS references
- Prior plan docs: unchanged (historical records)
