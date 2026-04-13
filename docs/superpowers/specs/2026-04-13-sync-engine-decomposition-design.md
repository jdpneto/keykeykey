# Sync Engine Decomposition Design

**Date:** 2026-04-13
**Status:** Draft
**Scope:** `packages/core/src/sync/` — internal restructuring with full consumer updates

## Problem

The graphify knowledge graph identifies the Sync Engine community as having the lowest cohesion score in the project (0.02). The root causes:

1. **`sync-config.ts`** is a god module: Zod schema + config encryption + adapter factory + engine factory + MEK derivation (267 lines, 10 exports)
2. **`sync-lifecycle.ts`** conflates lifecycle management with mismatch resolution, cloud restore, and master password validation (496 lines)
3. **OAuth provider files** duplicate identical token caching/refresh logic across three implementations
4. **Adapter files** duplicate HTTP auth-checking and error-handling patterns across four implementations
5. **`vault-blob.ts`** mixes wire format concerns with key derivation
6. All 20+ source files live in a single flat directory with no organizational hierarchy

This makes it difficult to add new sync providers (planned: FTP, Samba, additional OAuth providers post-launch) without touching multiple unrelated modules.

## Goals

1. **Maintainability** — Adding a new sync provider should mean implementing an interface and registering, not editing god modules
2. **Testability** — Each concern (merge, mismatch resolution, token caching, config encryption) testable in isolation
3. **Readability** — Smaller, focused files with clear single responsibilities
4. **Extensibility** — Clean plugin path for post-launch providers (FTP, Samba, etc.)

## Non-Goals

- Runtime plugin discovery or dynamic adapter registration
- Changing the `ISyncAdapter` interface contract (it's already clean)
- Altering sync algorithm behavior (LWW merge, tombstone GC, etc.)
- Adding new features — this is pure structural decomposition

## Constraints

- All consumers across the monorepo (28 files in extension, desktop, mobile, core) will be updated
- The public entry point `@keykeykey/core/sync` remains the facade — apps import from there
- Two relative imports within core (`export-import-zip/`) need path updates
- All existing tests must pass without behavioral changes

## Design

### Directory Structure

```
packages/core/src/sync/
├── index.ts                        # Public facade — re-exports everything
├── core/
│   ├── sync-engine.ts              # SyncEngine class
│   ├── merge.ts                    # mergeManifestsV2, mergeItemSets
│   ├── tombstone.ts                # garbageCollectTombstones
│   ├── types.ts                    # ISyncAdapter, SyncManifest, SyncItemMeta, TombstoneEntry
│   └── errors.ts                   # SyncAuthError, SyncAdapterUnsupportedError
├── adapters/
│   ├── index.ts                    # Re-exports all adapters
│   ├── base-http-adapter.ts        # NEW: shared checkAuth(), isNotFound(), fetchRetry wiring
│   ├── webdav-adapter.ts           # Extends BaseHttpAdapter
│   ├── google-drive-adapter.ts     # Extends BaseHttpAdapter
│   ├── dropbox-adapter.ts          # Extends BaseHttpAdapter
│   ├── onedrive-adapter.ts         # Extends BaseHttpAdapter
│   ├── memory-adapter.ts           # Standalone test adapter (no base class)
│   └── fetch-with-retry.ts         # Retry utility with exponential backoff
├── oauth/
│   ├── index.ts                    # Re-exports all OAuth
│   ├── pkce.ts                     # generateCodeVerifier, generateCodeChallenge, generateState
│   ├── oauth-client.ts             # buildAuthUrl, exchangeAuthCode, refreshAccessToken, revokeToken, OAuthError
│   ├── cached-token-provider.ts    # NEW: shared token caching with auto-refresh
│   ├── google.ts                   # Google endpoints + scope + thin wrappers
│   ├── dropbox.ts                  # Dropbox endpoints + thin wrappers
│   └── onedrive.ts                 # OneDrive endpoints + thin wrappers
├── config/
│   ├── schema.ts                   # SyncProvider, SyncConfigSchema, SyncConfig, DEFAULT_SYNC_CONFIG
│   ├── encryption.ts               # encryptSyncConfig, decryptSyncConfig
│   └── factory.ts                  # createAdapterFromConfig, createSyncEngineFromConfig, initSyncEngine, deriveMEKFromAdapter, getAvailableProviders, AdapterOverrides
├── lifecycle/
│   ├── sync-lifecycle.ts           # SyncLifecycle (slimmed), PlatformStorage, callbacks, interfaces
│   ├── mismatch-resolver.ts        # NEW: clearMismatch, replaceRemote, replaceLocal, mergeVaults
│   └── restore.ts                  # restoreFromCloud (absorbs check-cloud-conflict logic)
├── blob/
│   ├── vault-blob.ts               # Preamble, encryptVaultBlob, decryptVaultBlob, readPreambleFromBlob, VaultBlobSchema
│   └── mek.ts                      # deriveMEK, validateArgon2Params, generateSyncSalt
├── connect.ts                      # connectSyncEngine (tiny, stays at top)
└── delete-cloud-vault.ts           # deleteCloudVault (tiny, stays at top)
```

### Component Details

#### 1. `core/` — Sync Algorithm

Contains the sync engine, merge strategy, tombstone GC, shared types, and error classes. No HTTP, no OAuth, no config — pure sync logic.

**`core/types.ts`** — The `ISyncAdapter` interface (unchanged):
```typescript
interface ISyncAdapter {
  readVaultBlob(): Promise<Uint8Array | null>;
  writeVaultBlob(data: Uint8Array): Promise<void>;
  readItem(id: string): Promise<Uint8Array | null>;
  writeItem(id: string, data: Uint8Array): Promise<void>;
  deleteItem(id: string): Promise<void>;
  listItems(): Promise<string[]>;
  readLegacyManifest?(): Promise<SyncManifest | null>;
  deleteLegacyManifest?(): Promise<void>;
}
```

**`core/sync-engine.ts`** — Logic unchanged. Imports shift from sibling files to `./types.js`, `./merge.js`, `./tombstone.js`, `../blob/vault-blob.js`.

**`core/errors.ts`** — `SyncAuthError` and `SyncAdapterUnsupportedError` extracted to a shared location so both adapters and lifecycle can import them without circular deps.

#### 2. `adapters/` — Storage Backends

Each adapter implements `ISyncAdapter`. HTTP-based adapters extend `BaseHttpAdapter`.

**`adapters/base-http-adapter.ts`** (new):
```typescript
export abstract class BaseHttpAdapter implements ISyncAdapter {
  protected fetchRetry: typeof fetchWithRetry;

  constructor(protected options: { fetch?: typeof fetch }) {
    this.fetchRetry = (input, init, retryOpts) =>
      fetchWithRetry(input, init, { ...retryOpts, fetch: options.fetch });
  }

  protected checkAuth(response: Response): void {
    if (response.status === 401 || response.status === 403) {
      throw new SyncAuthError(`Auth failed: ${response.status}`);
    }
  }

  protected isNotFound(response: Response): boolean {
    return response.status === 404;
  }

  abstract readVaultBlob(): Promise<Uint8Array | null>;
  abstract writeVaultBlob(data: Uint8Array): Promise<void>;
  abstract readItem(id: string): Promise<Uint8Array | null>;
  abstract writeItem(id: string, data: Uint8Array): Promise<void>;
  abstract deleteItem(id: string): Promise<void>;
  abstract listItems(): Promise<string[]>;
}
```

Concrete adapters override `isNotFound()` where needed (e.g., Dropbox checks `error_summary` for `path/not_found`). The duplicated `checkAuth` + retry wiring disappears from individual adapters.

`MemoryAdapter` stays standalone — no HTTP, no base class.

**Adding a new HTTP adapter** = extend `BaseHttpAdapter`, implement the 6 abstract methods, override `isNotFound()` if the provider uses non-standard error codes.

#### 3. `oauth/` — Authentication

Splits the current monolithic `oauth.ts` (304 lines) into three focused modules:

**`oauth/pkce.ts`** — Pure crypto, no HTTP:
- `generateCodeVerifier()`, `generateCodeChallenge()`, `generateState()`

**`oauth/oauth-client.ts`** — Generic OAuth 2.0 HTTP operations:
- `buildAuthUrl()`, `exchangeAuthCode()`, `refreshAccessToken()`, `revokeToken()`
- `OAuthError` class
- Types: `OAuthEndpoints`, `TokenResponse`, `BuildAuthUrlParams`, etc.

**`oauth/cached-token-provider.ts`** — Extracted token caching:
- `createCachedTokenProvider(config: { endpoint, refreshToken, clientId, clientSecret?, bufferSeconds? }): () => Promise<string>`
- Single implementation replaces the three duplicated versions in google-oauth/dropbox-oauth/onedrive-oauth

**Provider files** become pure configuration + thin wrappers:
- `oauth/google.ts`: `GOOGLE_ENDPOINTS`, `GOOGLE_SCOPE`, wrappers passing Google config to generic functions
- `oauth/dropbox.ts`: `DROPBOX_ENDPOINTS`, wrappers passing Dropbox config
- `oauth/onedrive.ts`: `ONEDRIVE_ENDPOINTS`, `ONEDRIVE_SCOPE`, wrappers

**Adding a new OAuth provider** = create one file with endpoints, scope, and thin wrappers. No new caching/refresh logic.

#### 4. `config/` — Configuration

Splits the god module `sync-config.ts` into three files:

**`config/schema.ts`** — Pure data definitions:
- `SyncProvider` type union
- `SyncConfigSchema` (Zod discriminated union with per-provider fields)
- `SyncConfig` type (inferred)
- `DEFAULT_SYNC_CONFIG` (`{ provider: 'none' }`)

**`config/encryption.ts`** — Config persistence:
- `encryptSyncConfig(config, dek)` — Zod validate → JSON → XChaCha20-Poly1305
- `decryptSyncConfig(data, dek)` — decrypt → parse → Zod validate

**`config/factory.ts`** — Adapter/engine creation:
- `createAdapterFromConfig(config, overrides?)` — switch on provider, instantiate adapter with token provider
- `createSyncEngineFromConfig(...)` — combines adapter creation + `new SyncEngine()`
- `initSyncEngine(engine, store)` — fire-and-forget initial sync + store subscription
- `deriveMEKFromAdapter(adapter, masterPassword, fallbackParams)` — reads remote preamble or generates fresh salt
- `getAvailableProviders()` — returns supported provider list
- `AdapterOverrides` type

The factory switch is the natural evolution point for a registration map when more providers arrive.

#### 5. `lifecycle/` — Orchestration

**`lifecycle/sync-lifecycle.ts`** (~300 lines, down from 496):
- `SyncLifecycle` class: `initAfterUnlock()`, `saveConfig()`, `triggerSync()`, `getStatus()`, `recordTombstone()`, `validateMasterPassword()`, engine create/teardown, periodic sync
- `PlatformStorage` interface (lifecycle's dependency contract)
- `SyncLifecycleCallbacks`, `SubscribableSyncStore` interfaces
- Delegates mismatch operations to `MismatchResolver`

**`lifecycle/mismatch-resolver.ts`** (~120 lines, new):
- Functions: `clearMismatch()`, `replaceRemote()`, `replaceLocal()`, `mergeVaults()`
- Takes a narrow context interface (config, engine, platform storage, callbacks) rather than the full `SyncLifecycle` class
- `SyncLifecycle` wires these in and exposes them as methods

**`lifecycle/restore.ts`** (~100 lines):
- `restoreFromCloud(config, password, platformStorage, onProgress)` — download, decrypt, validate, persist
- Absorbs `check-cloud-conflict.ts` logic (only used during restore)
- `RestoreProgressEvent` type

#### 6. `blob/` — Vault Blob Encryption

**`blob/vault-blob.ts`** — Wire format:
- `PREAMBLE_SIZE` (32), `VaultBlobSchema`, `VaultBlob` type
- `encryptVaultBlob()`, `decryptVaultBlob()`, `readPreambleFromBlob()`

**`blob/mek.ts`** — Key derivation (separate concern):
- `generateSyncSalt()` — random 16 bytes
- `deriveMEK(password, salt, params)` — delegates to Argon2id via `deriveKEK`
- `validateArgon2Params(params)` — bounds checking (t:1-10, m:8192-262144, p:1-16, dkLen:32)

Split avoids circular deps: both `blob/vault-blob.ts` and `config/factory.ts` need MEK derivation.

### Public API (`sync/index.ts`)

The facade re-exports all public symbols from sub-modules. Organized by section:

```typescript
// Core
export { SyncEngine, type SyncResult, type SyncableStore, type SyncEngineOptions, type VaultMismatchInfo } from './core/sync-engine.js';
export { type ISyncAdapter, type SyncManifest, type SyncItemMeta, type TombstoneEntry } from './core/types.js';
export { mergeManifestsV2, mergeItemSets } from './core/merge.js';
export { garbageCollectTombstones } from './core/tombstone.js';
export { SyncAuthError, SyncAdapterUnsupportedError } from './core/errors.js';

// Adapters
export { WebDavAdapter, GoogleDriveAdapter, DropboxAdapter, OneDriveAdapter, MemoryAdapter } from './adapters/index.js';

// OAuth
export { generateCodeVerifier, generateCodeChallenge, generateState } from './oauth/pkce.js';
export { buildAuthUrl, exchangeAuthCode, refreshAccessToken, revokeToken, OAuthError } from './oauth/oauth-client.js';
export type { OAuthEndpoints, TokenResponse, BuildAuthUrlParams, ExchangeAuthCodeParams, RefreshParams, RefreshResponse } from './oauth/oauth-client.js';
export { createCachedTokenProvider } from './oauth/cached-token-provider.js';
export { GOOGLE_ENDPOINTS, buildAuthUrl as buildGoogleAuthUrl, exchangeAuthCode as exchangeGoogleAuthCode, revokeToken as revokeGoogleToken, createCachedTokenProvider as createGoogleTokenProvider } from './oauth/google.js';
export { DROPBOX_ENDPOINTS, buildDropboxAuthUrl, exchangeDropboxAuthCode, revokeDropboxToken, createDropboxTokenProvider } from './oauth/dropbox.js';
export { ONEDRIVE_ENDPOINTS, ONEDRIVE_SCOPE, buildOneDriveAuthUrl, exchangeOneDriveAuthCode, createOneDriveTokenProvider } from './oauth/onedrive.js';

// Config
export { type SyncConfig, type SyncProvider, DEFAULT_SYNC_CONFIG } from './config/schema.js';
export { encryptSyncConfig, decryptSyncConfig } from './config/encryption.js';
export { createAdapterFromConfig, createSyncEngineFromConfig, initSyncEngine, deriveMEKFromAdapter, getAvailableProviders, type AdapterOverrides } from './config/factory.js';

// Lifecycle
export { SyncLifecycle, type PlatformStorage, type SyncLifecycleCallbacks, type SubscribableSyncStore } from './lifecycle/sync-lifecycle.js';
export { restoreFromCloud, type RestoreProgressEvent } from './lifecycle/restore.js';

// Blob
export { PREAMBLE_SIZE, encryptVaultBlob, decryptVaultBlob, readPreambleFromBlob, VaultBlobSchema, type VaultBlob } from './blob/vault-blob.js';
export { generateSyncSalt, deriveMEK, validateArgon2Params } from './blob/mek.js';

// Utilities
export { connectSyncEngine } from './connect.js';
export { deleteCloudVault } from './delete-cloud-vault.js';
```

All existing consumer imports from `@keykeykey/core/sync` continue to resolve. The two relative imports within core need path updates:
- `export-import-zip/encrypted-import.ts`: `../sync/vault-blob.js` → `../sync/blob/mek.js` (for `validateArgon2Params`)
- `export-import-zip/collect-vault-files.ts` + test: `../sync/types.js` → `../sync/core/types.js`

### File Migration Map

| Current file | New location | Change type |
|---|---|---|
| `types.ts` | `core/types.ts` | Move, remove deprecated `mergeManifests` |
| `sync-engine.ts` | `core/sync-engine.ts` | Move, update imports |
| `merge.ts` | `core/merge.ts` | Move |
| `tombstone.ts` | `core/tombstone.ts` | Move |
| `errors.ts` | `core/errors.ts` | Move |
| `webdav-adapter.ts` | `adapters/webdav-adapter.ts` | Move, extend BaseHttpAdapter |
| `google-drive-adapter.ts` | `adapters/google-drive-adapter.ts` | Move, extend BaseHttpAdapter |
| `dropbox-adapter.ts` | `adapters/dropbox-adapter.ts` | Move, extend BaseHttpAdapter |
| `onedrive-adapter.ts` | `adapters/onedrive-adapter.ts` | Move, extend BaseHttpAdapter |
| `memory-adapter.ts` | `adapters/memory-adapter.ts` | Move |
| (new) | `adapters/base-http-adapter.ts` | New file |
| `fetch-with-retry.ts` | `adapters/fetch-with-retry.ts` | Move |
| `oauth.ts` | `oauth/pkce.ts` + `oauth/oauth-client.ts` + `oauth/cached-token-provider.ts` | Split |
| `google-oauth.ts` | `oauth/google.ts` | Refactor to use shared cached-token-provider |
| `dropbox-oauth.ts` | `oauth/dropbox.ts` | Refactor to use shared cached-token-provider |
| `onedrive-oauth.ts` | `oauth/onedrive.ts` | Refactor to use shared cached-token-provider |
| `sync-config.ts` | `config/schema.ts` + `config/encryption.ts` + `config/factory.ts` | Split |
| `sync-lifecycle.ts` | `lifecycle/sync-lifecycle.ts` + `lifecycle/mismatch-resolver.ts` | Split |
| `restore.ts` | `lifecycle/restore.ts` | Move, absorb check-cloud-conflict |
| `check-cloud-conflict.ts` | (absorbed into `lifecycle/restore.ts`) | Delete |
| `vault-blob.ts` | `blob/vault-blob.ts` + `blob/mek.ts` | Split |
| `connect.ts` | `connect.ts` | Stay |
| `delete-cloud-vault.ts` | `delete-cloud-vault.ts` | Stay |
| `index.ts` | `index.ts` | Rewrite as organized facade |

### Test Migration

All test files move alongside their source files:
- `sync-engine.test.ts` → `core/sync-engine.test.ts`
- `merge.test.ts` → `core/merge.test.ts`
- `webdav-adapter.test.ts` → `adapters/webdav-adapter.test.ts`
- etc.

Test imports update to match new relative paths. No behavioral changes — tests should pass identically.

### Consumer Updates

**28 consumer files** across extension, desktop, mobile, and core. All import from `@keykeykey/core/sync` which remains the public entry point. The facade `index.ts` re-exports everything, so **no consumer import paths change**.

The only exceptions are 2-3 relative imports within core's `export-import-zip/`:
- `../sync/vault-blob.js` → `../sync/blob/mek.js`
- `../sync/types.js` → `../sync/core/types.js`

## Testing Strategy

1. All existing unit tests move with their source files, import paths updated
2. Run `pnpm --filter @keykeykey/core test` after each sub-module migration to catch breakage immediately
3. Run `pnpm build` after complete migration to verify tsup entry points resolve
4. Run `pnpm test` across all packages to verify no consumer breakage
5. Run `cd e2e && npx playwright test --grep @critical` before pushing

## Risks

- **Import resolution in tsup**: The core package uses tsup with multiple entry points. The sub-module structure should work since `index.ts` remains the entry point, but needs verification during build.
- **Circular dependencies**: The split is designed to avoid cycles (errors in `core/`, MEK in `blob/`, types in `core/`). If any arise during implementation, they indicate a design boundary error to fix.
- **Test helper imports**: Some tests use `makeSyncEngine` and other helpers that may need path updates.
