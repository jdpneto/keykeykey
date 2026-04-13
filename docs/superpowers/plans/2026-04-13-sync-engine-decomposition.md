# Sync Engine Decomposition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Decompose the flat `packages/core/src/sync/` module into 6 focused sub-modules (core, adapters, oauth, config, lifecycle, blob) to improve cohesion from 0.02 to a maintainable level.

**Architecture:** Bottom-up migration — move leaf modules first (types, errors), then mid-level modules (adapters, oauth, blob), then orchestrators (config, lifecycle). After each task, update `sync/index.ts` so all exports resolve and tests pass. No behavioral changes. Shim files bridge old imports during migration.

**Tech Stack:** TypeScript 5.7, Vitest, tsup, pnpm workspaces

---

## File Structure

### New files to create:
- `sync/core/types.ts`, `sync/core/errors.ts`, `sync/core/merge.ts`, `sync/core/tombstone.ts`, `sync/core/sync-engine.ts`
- `sync/adapters/index.ts`, `sync/adapters/base-http-adapter.ts`, `sync/adapters/fetch-with-retry.ts`
- `sync/adapters/webdav-adapter.ts`, `sync/adapters/google-drive-adapter.ts`, `sync/adapters/dropbox-adapter.ts`, `sync/adapters/onedrive-adapter.ts`, `sync/adapters/memory-adapter.ts`
- `sync/oauth/index.ts`, `sync/oauth/pkce.ts`, `sync/oauth/oauth-client.ts`, `sync/oauth/cached-token-provider.ts`
- `sync/oauth/google.ts`, `sync/oauth/dropbox.ts`, `sync/oauth/onedrive.ts`
- `sync/config/schema.ts`, `sync/config/encryption.ts`, `sync/config/factory.ts`
- `sync/lifecycle/sync-lifecycle.ts`, `sync/lifecycle/mismatch-resolver.ts`, `sync/lifecycle/restore.ts`
- `sync/blob/vault-blob.ts`, `sync/blob/mek.ts`

(All paths relative to `packages/core/src/`)

### Files to delete after migration:
All original flat files in `sync/` (types.ts, errors.ts, merge.ts, tombstone.ts, sync-engine.ts, memory-adapter.ts, fetch-with-retry.ts, webdav-adapter.ts, google-drive-adapter.ts, dropbox-adapter.ts, onedrive-adapter.ts, oauth.ts, google-oauth.ts, dropbox-oauth.ts, onedrive-oauth.ts, sync-config.ts, sync-lifecycle.ts, vault-blob.ts, restore.ts, check-cloud-conflict.ts)

### Test files to move:
Each test file moves to sit alongside its source in the new sub-module directory. Imports updated accordingly.

---

### Task 1: Create `core/` sub-module (types, errors, merge, tombstone)

**Files:**
- Create: `sync/core/types.ts`, `sync/core/errors.ts`, `sync/core/merge.ts`, `sync/core/tombstone.ts`
- Modify: `sync/index.ts`, old files become re-export shims

- [ ] **Step 1: Create directories**

Run:
```bash
mkdir -p packages/core/src/sync/{core,adapters,oauth,config,lifecycle,blob}
```

- [ ] **Step 2: Create core/types.ts**

Create `packages/core/src/sync/core/types.ts` with the ISyncAdapter interface and manifest types. Identical to current `types.ts` but **without** the deprecated `mergeManifests` function (no consumers).

```typescript
/**
 * Sync adapter interface and manifest types.
 */

/** Metadata for a single synced item. */
export type SyncItemMeta = {
  updatedAt: string;
  hash: string;
};

/** Metadata for a deleted item (tombstone). */
export type TombstoneEntry = {
  deletedAt: string;
};

/** Sync manifest — tracks all items and their metadata. */
export type SyncManifest = {
  version: number;
  lastModified: string;
  items: Record<string, SyncItemMeta>;
  tombstones?: Record<string, TombstoneEntry>;
  vaultId?: string;
};

/**
 * Interface for sync storage adapters.
 * All data passed through these methods is already encrypted (ciphertext only).
 */
export interface ISyncAdapter {
  readVaultBlob(): Promise<Uint8Array | null>;
  writeVaultBlob(data: Uint8Array): Promise<void>;
  readLegacyManifest?(): Promise<SyncManifest | null>;
  deleteLegacyManifest?(): Promise<void>;
  readItem(id: string): Promise<Uint8Array | null>;
  writeItem(id: string, data: Uint8Array): Promise<void>;
  deleteItem(id: string): Promise<void>;
  listItems(): Promise<string[]>;
}
```

- [ ] **Step 3: Copy errors.ts and tombstone.ts to core/**

Run:
```bash
cp packages/core/src/sync/errors.ts packages/core/src/sync/core/errors.ts
cp packages/core/src/sync/tombstone.ts packages/core/src/sync/core/tombstone.ts
```

`errors.ts` has no imports — works as-is. `tombstone.ts` imports `./types.js` which is now a sibling — works as-is.

- [ ] **Step 4: Copy merge.ts to core/**

Run:
```bash
cp packages/core/src/sync/merge.ts packages/core/src/sync/core/merge.ts
```

Imports `./types.js` and `./tombstone.js` — both are siblings in `core/`. Works as-is.

- [ ] **Step 5: Replace old files with re-export shims**

`packages/core/src/sync/types.ts`:
```typescript
export type { ISyncAdapter, SyncManifest, SyncItemMeta, TombstoneEntry } from './core/types.js';
// Deprecated mergeManifests intentionally dropped
```

`packages/core/src/sync/errors.ts`:
```typescript
export { SyncAuthError, SyncAdapterUnsupportedError } from './core/errors.js';
```

`packages/core/src/sync/merge.ts`:
```typescript
export { mergeManifestsV2, mergeItemSets } from './core/merge.js';
export type { MergeResult } from './core/merge.js';
```

`packages/core/src/sync/tombstone.ts`:
```typescript
export { garbageCollectTombstones } from './core/tombstone.js';
```

- [ ] **Step 6: Update sync/index.ts core exports**

In `packages/core/src/sync/index.ts`, change:

```typescript
// OLD:
export { mergeManifests } from './types.js';
export type { ISyncAdapter, SyncManifest, SyncItemMeta, TombstoneEntry } from './types.js';
export { garbageCollectTombstones } from './tombstone.js';
export { SyncAuthError, SyncAdapterUnsupportedError } from './errors.js';
export { mergeManifestsV2, mergeItemSets } from './merge.js';
export type { MergeResult } from './merge.js';
```

to:

```typescript
// NEW:
export type { ISyncAdapter, SyncManifest, SyncItemMeta, TombstoneEntry } from './core/types.js';
export { garbageCollectTombstones } from './core/tombstone.js';
export { SyncAuthError, SyncAdapterUnsupportedError } from './core/errors.js';
export { mergeManifestsV2, mergeItemSets } from './core/merge.js';
export type { MergeResult } from './core/merge.js';
```

- [ ] **Step 7: Run tests to verify**

Run: `pnpm --filter @keykeykey/core test`
Expected: All tests pass.

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/sync/core/ packages/core/src/sync/types.ts packages/core/src/sync/errors.ts packages/core/src/sync/merge.ts packages/core/src/sync/tombstone.ts packages/core/src/sync/index.ts
git commit -m "refactor(core/sync): extract core/ sub-module (types, errors, merge, tombstone)"
```

---

### Task 2: Create `blob/` sub-module

**Files:**
- Create: `sync/blob/vault-blob.ts`, `sync/blob/mek.ts`
- Modify: `sync/vault-blob.ts` (becomes shim), `sync/index.ts`

- [ ] **Step 1: Create blob/mek.ts**

Extract `generateSyncSalt`, `deriveMEK`, `validateArgon2Params` from vault-blob.ts.

Create `packages/core/src/sync/blob/mek.ts`:
```typescript
import { randomBytes } from '@noble/hashes/utils';
import { deriveKEK } from '../../crypto/kdf.js';
import { SALT_SIZE, KEY_SIZE } from '../../crypto/constants.js';
import type { Argon2Params } from '../../crypto/constants.js';

export function generateSyncSalt(): Uint8Array {
  return randomBytes(SALT_SIZE);
}

export async function deriveMEK(
  masterPassword: string,
  syncSalt: Uint8Array,
  params: Argon2Params,
): Promise<Uint8Array> {
  return deriveKEK(masterPassword, syncSalt, params);
}

export function validateArgon2Params(params: Argon2Params): void {
  if (params.t < 1 || params.t > 10) {
    throw new Error(`Argon2 t (iterations) must be 1-10, got ${params.t}`);
  }
  if (params.m < 8192 || params.m > 262144) {
    throw new Error(`Argon2 m (memory KiB) must be 8192-262144, got ${params.m}`);
  }
  if (params.p < 1 || params.p > 16) {
    throw new Error(`Argon2 p (parallelism) must be 1-16, got ${params.p}`);
  }
  if (params.dkLen !== KEY_SIZE) {
    throw new Error(`Argon2 dkLen must be ${KEY_SIZE}, got ${params.dkLen}`);
  }
}
```

- [ ] **Step 2: Create blob/vault-blob.ts**

Copy current `vault-blob.ts` to `blob/vault-blob.ts`. Remove `generateSyncSalt`, `deriveMEK`, `validateArgon2Params` (now in mek.ts). Update imports:
- `'../crypto/encryption.js'` becomes `'../../crypto/encryption.js'`
- `'../crypto/kdf.js'` removed (was only used by deriveMEK)
- `'../crypto/constants.js'` becomes `'../../crypto/constants.js'`
- `'../utils/base64.js'` becomes `'../../utils/base64.js'`
- `'./types.js'` becomes `'../core/types.js'`
- Remove `randomBytes` import (moved to mek.ts)

The file retains: `PREAMBLE_SIZE`, `VaultBlobSchema`, `VaultBlob`, `readPreambleFromBlob`, `encryptVaultBlob`, `decryptVaultBlob`, and private `buildPreamble`.

- [ ] **Step 3: Replace sync/vault-blob.ts with shim**

```typescript
export { PREAMBLE_SIZE, encryptVaultBlob, decryptVaultBlob, readPreambleFromBlob, VaultBlobSchema } from './blob/vault-blob.js';
export type { VaultBlob } from './blob/vault-blob.js';
export { generateSyncSalt, deriveMEK, validateArgon2Params } from './blob/mek.js';
```

- [ ] **Step 4: Update sync/index.ts blob exports to point to blob/**

Replace vault-blob exports with:
```typescript
export { PREAMBLE_SIZE, encryptVaultBlob, decryptVaultBlob, readPreambleFromBlob, VaultBlobSchema } from './blob/vault-blob.js';
export type { VaultBlob } from './blob/vault-blob.js';
export { generateSyncSalt, deriveMEK, validateArgon2Params } from './blob/mek.js';
```

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @keykeykey/core test`
Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/sync/blob/ packages/core/src/sync/vault-blob.ts packages/core/src/sync/index.ts
git commit -m "refactor(core/sync): extract blob/ sub-module (vault-blob + mek)"
```

---

### Task 3: Create `adapters/` sub-module

**Files:**
- Create: `sync/adapters/base-http-adapter.ts`, `sync/adapters/index.ts`
- Move + modify: all adapter files + fetch-with-retry.ts
- Modify: old files become shims, `sync/index.ts`

- [ ] **Step 1: Copy fetch-with-retry.ts**

Run: `cp packages/core/src/sync/fetch-with-retry.ts packages/core/src/sync/adapters/fetch-with-retry.ts`

No changes needed — no internal imports.

- [ ] **Step 2: Create base-http-adapter.ts**

```typescript
import type { ISyncAdapter } from '../core/types.js';
import { SyncAuthError } from '../core/errors.js';
import { fetchWithRetry } from './fetch-with-retry.js';
import type { FetchRetryOptions } from './fetch-with-retry.js';

export abstract class BaseHttpAdapter implements ISyncAdapter {
  protected fetchRetry(
    input: RequestInfo | URL,
    init?: RequestInit,
    options?: FetchRetryOptions,
  ): Promise<Response> {
    return fetchWithRetry(input, init, options);
  }

  protected checkAuth(res: { ok: boolean; status: number }): void {
    if (res.status === 401 || res.status === 403) {
      throw new SyncAuthError(`Auth failed (HTTP ${res.status})`);
    }
  }

  protected isNotFound(res: { status: number }): boolean {
    return res.status === 404;
  }

  abstract readVaultBlob(): Promise<Uint8Array | null>;
  abstract writeVaultBlob(data: Uint8Array): Promise<void>;
  abstract readItem(id: string): Promise<Uint8Array | null>;
  abstract writeItem(id: string, data: Uint8Array): Promise<void>;
  abstract deleteItem(id: string): Promise<void>;
  abstract listItems(): Promise<string[]>;
}
```

- [ ] **Step 3: Move all adapter files to adapters/**

For each adapter, copy the file to `adapters/`, update imports (`'./types.js'` to `'../core/types.js'`, `'./errors.js'` to `'../core/errors.js'`, `'./fetch-with-retry.js'` to `'./fetch-with-retry.js'`), and extend BaseHttpAdapter where applicable.

For **WebDavAdapter**: extend `BaseHttpAdapter`, add `super()` to constructor, change private `checkAuth` to `protected override checkAuth`, keep using raw `fetch` (not `this.fetchRetry`) since WebDAV doesn't need retry logic.

For **GoogleDriveAdapter**: extend `BaseHttpAdapter`, add `super()` to constructor, change `fetchWithRetry` calls to `this.fetchRetry`, change private `checkAuth` to `protected override checkAuth`.

For **DropboxAdapter**: extend `BaseHttpAdapter`, add `super()` to constructor, change `fetchWithRetry` calls to `this.fetchRetry`, change private `checkAuth` to `protected override checkAuth`. Keep private `isNotFound` as-is (different signature from base).

For **OneDriveAdapter**: extend `BaseHttpAdapter`, add `super()` to constructor, change `fetchWithRetry` calls to `this.fetchRetry`, change private `checkAuth` to `protected override checkAuth`.

For **MemoryAdapter**: copy with import change only (`'../core/types.js'`). Does NOT extend BaseHttpAdapter.

- [ ] **Step 4: Create adapters/index.ts**

```typescript
export { BaseHttpAdapter } from './base-http-adapter.js';
export { fetchWithRetry } from './fetch-with-retry.js';
export type { FetchRetryOptions } from './fetch-with-retry.js';
export { MemoryAdapter } from './memory-adapter.js';
export { WebDavAdapter } from './webdav-adapter.js';
export type { WebDavAdapterOptions } from './webdav-adapter.js';
export { GoogleDriveAdapter } from './google-drive-adapter.js';
export type { GoogleDriveAdapterOptions } from './google-drive-adapter.js';
export { DropboxAdapter } from './dropbox-adapter.js';
export type { DropboxAdapterOptions } from './dropbox-adapter.js';
export { OneDriveAdapter } from './onedrive-adapter.js';
export type { OneDriveAdapterOptions } from './onedrive-adapter.js';
```

- [ ] **Step 5: Replace old adapter files with shims and update sync/index.ts**

Each old file becomes a one-line re-export (e.g., `export { MemoryAdapter } from './adapters/memory-adapter.js'`). Update `sync/index.ts` adapter section to import from `./adapters/`.

- [ ] **Step 6: Run tests**

Run: `pnpm --filter @keykeykey/core test`
Expected: All tests pass.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/sync/adapters/ packages/core/src/sync/memory-adapter.ts packages/core/src/sync/webdav-adapter.ts packages/core/src/sync/google-drive-adapter.ts packages/core/src/sync/dropbox-adapter.ts packages/core/src/sync/onedrive-adapter.ts packages/core/src/sync/fetch-with-retry.ts packages/core/src/sync/index.ts
git commit -m "refactor(core/sync): extract adapters/ sub-module with BaseHttpAdapter"
```

---

### Task 4: Create `oauth/` sub-module

**Files:**
- Create: `sync/oauth/pkce.ts`, `sync/oauth/oauth-client.ts`, `sync/oauth/cached-token-provider.ts`
- Create: `sync/oauth/google.ts`, `sync/oauth/dropbox.ts`, `sync/oauth/onedrive.ts`
- Create: `sync/oauth/index.ts`
- Modify: old OAuth files become shims, `sync/index.ts`

- [ ] **Step 1: Create oauth/pkce.ts**

Extract `generateCodeVerifier`, `generateCodeChallenge`, `generateState`, and private `base64UrlEncode` + `UNRESERVED` from oauth.ts. No external imports needed.

- [ ] **Step 2: Create oauth/oauth-client.ts**

Extract types (`OAuthEndpoints`, `BuildAuthUrlParams`, `ExchangeAuthCodeParams`, `TokenResponse`, `RefreshParams`, `RefreshResponse`), `OAuthError` class, and functions (`buildAuthUrl`, `exchangeAuthCode`, `refreshAccessToken`, `revokeToken`) from oauth.ts. Import `generateCodeChallenge` from `./pkce.js` and `SyncAuthError` from `../core/errors.js`.

- [ ] **Step 3: Create oauth/cached-token-provider.ts**

Extract `createCachedTokenProvider` from oauth.ts. Import `refreshAccessToken` from `./oauth-client.js`.

- [ ] **Step 4: Move provider files with updated imports**

`oauth/google.ts`: Copy google-oauth.ts. Change all `from './oauth.js'` imports to appropriate new modules:
- `OAuthError` from `./oauth-client.js`
- `generateCodeVerifier`, `generateCodeChallenge` from `./pkce.js`
- `buildAuthUrl as genericBuildAuthUrl`, etc. from `./oauth-client.js`
- `createCachedTokenProvider as genericCreateCachedTokenProvider` from `./cached-token-provider.js`

`oauth/dropbox.ts` and `oauth/onedrive.ts`: Same pattern.

- [ ] **Step 5: Create oauth/index.ts barrel**

Re-export everything from all oauth sub-files. Use aliases for Google-specific exports that shadow generic names.

- [ ] **Step 6: Replace old OAuth files with shims and update sync/index.ts**

`sync/oauth.ts`: Re-export from `./oauth/pkce.js`, `./oauth/oauth-client.js`, `./oauth/cached-token-provider.js`.
`sync/google-oauth.ts`: `export * from './oauth/google.js'`
`sync/dropbox-oauth.ts`: `export * from './oauth/dropbox.js'`
`sync/onedrive-oauth.ts`: `export * from './oauth/onedrive.js'`

Update `sync/index.ts` OAuth section.

- [ ] **Step 7: Run tests**

Run: `pnpm --filter @keykeykey/core test`
Expected: All tests pass.

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/sync/oauth/ packages/core/src/sync/oauth.ts packages/core/src/sync/google-oauth.ts packages/core/src/sync/dropbox-oauth.ts packages/core/src/sync/onedrive-oauth.ts packages/core/src/sync/index.ts
git commit -m "refactor(core/sync): extract oauth/ sub-module (pkce, client, cached-token-provider)"
```

---

### Task 5: Create `config/` sub-module

**Files:**
- Create: `sync/config/schema.ts`, `sync/config/encryption.ts`, `sync/config/factory.ts`
- Modify: `sync/sync-config.ts` (becomes shim), `sync/index.ts`

- [ ] **Step 1: Create config/schema.ts**

Extract `SyncProvider` type, `SyncConfigSchema`, `SyncConfig` type, `DEFAULT_SYNC_CONFIG` from sync-config.ts.

```typescript
import { z } from 'zod';

export type SyncProvider = 'none' | 'webdav' | 'google-drive' | 'dropbox' | 'onedrive';

export const SyncConfigSchema = z.object({
  provider: z.enum(['none', 'webdav', 'google-drive', 'dropbox', 'onedrive']),
  masterPassword: z.string().optional(),
  webdav: z.object({ url: z.string(), username: z.string(), password: z.string() }).optional(),
  googleDrive: z
    .object({ refreshToken: z.string(), clientId: z.string(), clientSecret: z.string().optional() })
    .optional(),
  dropbox: z.object({ refreshToken: z.string(), clientId: z.string() }).optional(),
  onedrive: z.object({ refreshToken: z.string(), clientId: z.string() }).optional(),
});

export type SyncConfig = z.infer<typeof SyncConfigSchema>;
export const DEFAULT_SYNC_CONFIG: SyncConfig = { provider: 'none' };
```

- [ ] **Step 2: Create config/encryption.ts**

```typescript
import { encrypt, decrypt } from '../../crypto/encryption.js';
import { SyncConfigSchema } from './schema.js';
import type { SyncConfig } from './schema.js';

export function encryptSyncConfig(config: SyncConfig, dek: Uint8Array): Uint8Array {
  const json = JSON.stringify(config);
  return encrypt(new TextEncoder().encode(json), dek);
}

export function decryptSyncConfig(data: Uint8Array, dek: Uint8Array): SyncConfig {
  const plainBytes = decrypt(data, dek);
  const parsed: unknown = JSON.parse(new TextDecoder().decode(plainBytes));
  return SyncConfigSchema.parse(parsed);
}
```

- [ ] **Step 3: Create config/factory.ts**

Extract `AdapterOverrides`, `createAdapterFromConfig`, `createSyncEngineFromConfig`, `initSyncEngine`, `deriveMEKFromAdapter`, `getAvailableProviders` from sync-config.ts. Update all imports to new sub-module paths:
- `'../core/sync-engine.js'` for SyncEngine, SyncableStore, VaultMismatchInfo
- `'../core/types.js'` for ISyncAdapter
- `'../adapters/webdav-adapter.js'` for WebDavAdapter
- `'../adapters/google-drive-adapter.js'` for GoogleDriveAdapter
- `'../adapters/dropbox-adapter.js'` for DropboxAdapter
- `'../adapters/onedrive-adapter.js'` for OneDriveAdapter
- `'../oauth/google.js'` for createCachedTokenProvider
- `'../oauth/dropbox.js'` for createDropboxTokenProvider
- `'../oauth/onedrive.js'` for createOneDriveTokenProvider
- `'../blob/vault-blob.js'` for readPreambleFromBlob, PREAMBLE_SIZE
- `'../blob/mek.js'` for deriveMEK, generateSyncSalt, validateArgon2Params
- `'../connect.js'` for connectSyncEngine
- `'./schema.js'` for SyncConfig, SyncProvider

- [ ] **Step 4: Replace sync-config.ts with shim and update sync/index.ts**

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @keykeykey/core test`
Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/sync/config/ packages/core/src/sync/sync-config.ts packages/core/src/sync/index.ts
git commit -m "refactor(core/sync): extract config/ sub-module (schema, encryption, factory)"
```

---

### Task 6: Move sync-engine.ts to `core/`

**Files:**
- Create: `sync/core/sync-engine.ts`
- Modify: `sync/sync-engine.ts` (becomes shim), `sync/connect.ts`, `sync/index.ts`

- [ ] **Step 1: Create core/sync-engine.ts**

Copy sync-engine.ts with updated imports:
- `'./merge.js'` stays (sibling in core/)
- `'./types.js'` stays (sibling in core/)
- `'./vault-blob.js'` becomes `'../blob/vault-blob.js'`
- `'../crypto/*'` becomes `'../../crypto/*'`
- `'../models/*'` becomes `'../../models/*'`
- `'../utils/*'` becomes `'../../utils/*'`

- [ ] **Step 2: Replace sync-engine.ts with shim, update connect.ts and sync/index.ts**

`sync/sync-engine.ts`:
```typescript
export { SyncEngine } from './core/sync-engine.js';
export type { SyncResult, SyncableStore, SyncEngineOptions, VaultMismatchInfo } from './core/sync-engine.js';
```

`sync/connect.ts`: Change `import type { SyncEngine } from './sync-engine.js'` to `import type { SyncEngine } from './core/sync-engine.js'`.

`sync/index.ts`: Update SyncEngine exports to `'./core/sync-engine.js'`.

- [ ] **Step 3: Run tests**

Run: `pnpm --filter @keykeykey/core test`
Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/sync/core/sync-engine.ts packages/core/src/sync/sync-engine.ts packages/core/src/sync/connect.ts packages/core/src/sync/index.ts
git commit -m "refactor(core/sync): move sync-engine to core/ sub-module"
```

---

### Task 7: Create `lifecycle/` sub-module

**Files:**
- Create: `sync/lifecycle/sync-lifecycle.ts`, `sync/lifecycle/mismatch-resolver.ts`, `sync/lifecycle/restore.ts`
- Modify: old files become shims, `sync/index.ts`

- [ ] **Step 1: Create lifecycle/restore.ts**

Merge `restore.ts` + `check-cloud-conflict.ts` into one file. Update imports to `../../crypto/*`, `../../utils/*`, `../core/types.js`, `../blob/vault-blob.js`, `../blob/mek.js`.

Exports: `restoreFromCloud`, `RestoreProgressEvent`, `RestoreFromCloudResult`, `checkCloudConflict`, `CloudConflictResult`.

- [ ] **Step 2: Create lifecycle/mismatch-resolver.ts**

Extract `clearMismatch`, `replaceRemote`, `replaceLocal` (delegates to restoreFromCloud), `mergeVaults` from SyncLifecycle into standalone functions. Each takes a narrow context interface rather than the full class. Returns data needed for engine recreation (mek, syncSalt, etc.) so the caller (SyncLifecycle) handles engine teardown/setup.

- [ ] **Step 3: Create lifecycle/sync-lifecycle.ts**

Copy sync-lifecycle.ts with:
- All imports updated to new sub-module paths
- `clearMismatch`, `replaceRemote`, `mergeVaults` delegate to mismatch-resolver functions
- Engine teardown/recreation stays in the class (it owns the engine lifecycle)
- `restoreFromCloud` uses `./restore.js`

- [ ] **Step 4: Replace old files with shims and update sync/index.ts**

`sync/sync-lifecycle.ts`, `sync/restore.ts`, `sync/check-cloud-conflict.ts` become shims.

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @keykeykey/core test`
Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/sync/lifecycle/ packages/core/src/sync/sync-lifecycle.ts packages/core/src/sync/restore.ts packages/core/src/sync/check-cloud-conflict.ts packages/core/src/sync/index.ts
git commit -m "refactor(core/sync): extract lifecycle/ sub-module (lifecycle, mismatch-resolver, restore)"
```

---

### Task 8: Update remaining top-level files

**Files:**
- Modify: `sync/delete-cloud-vault.ts`, `sync/connect.ts`

- [ ] **Step 1: Update delete-cloud-vault.ts imports**

```typescript
// OLD:
import { encryptVaultBlob } from './vault-blob.js';
import type { ISyncAdapter, SyncManifest } from './types.js';

// NEW:
import { encryptVaultBlob } from './blob/vault-blob.js';
import type { ISyncAdapter, SyncManifest } from './core/types.js';
```

- [ ] **Step 2: Run tests and commit**

Run: `pnpm --filter @keykeykey/core test`

```bash
git add packages/core/src/sync/delete-cloud-vault.ts
git commit -m "refactor(core/sync): update remaining top-level file imports"
```

---

### Task 9: Update core-internal consumers

**Files:**
- Modify: `export-import-zip/encrypted-import.ts`, `export-import-zip/collect-vault-files.ts`, `export-import-zip/collect-vault-files.test.ts`

- [ ] **Step 1: Update encrypted-import.ts**

```typescript
// OLD:
import { validateArgon2Params } from '../sync/vault-blob.js';
// NEW:
import { validateArgon2Params } from '../sync/blob/mek.js';
```

- [ ] **Step 2: Update collect-vault-files.ts and its test**

```typescript
// OLD:
import type { ISyncAdapter } from '../sync/types.js';
// NEW:
import type { ISyncAdapter } from '../sync/core/types.js';
```

- [ ] **Step 3: Run tests and commit**

Run: `pnpm --filter @keykeykey/core test`

```bash
git add packages/core/src/export-import-zip/
git commit -m "refactor(core): update export-import-zip imports for sync decomposition"
```

---

### Task 10: Move test files

**Files:** All `sync/*.test.ts` files

- [ ] **Step 1: Copy test files to new locations**

```bash
# core/
cp packages/core/src/sync/tombstone.test.ts packages/core/src/sync/core/
cp packages/core/src/sync/merge.test.ts packages/core/src/sync/core/
cp packages/core/src/sync/sync-engine.test.ts packages/core/src/sync/core/
cp packages/core/src/sync/sync-conflict.test.ts packages/core/src/sync/core/

# adapters/
cp packages/core/src/sync/fetch-with-retry.test.ts packages/core/src/sync/adapters/
cp packages/core/src/sync/webdav-adapter.test.ts packages/core/src/sync/adapters/
cp packages/core/src/sync/google-drive-adapter.test.ts packages/core/src/sync/adapters/
cp packages/core/src/sync/dropbox-adapter.test.ts packages/core/src/sync/adapters/
cp packages/core/src/sync/onedrive-adapter.test.ts packages/core/src/sync/adapters/

# oauth/
cp packages/core/src/sync/oauth.test.ts packages/core/src/sync/oauth/oauth.test.ts
cp packages/core/src/sync/google-oauth.test.ts packages/core/src/sync/oauth/google.test.ts
cp packages/core/src/sync/dropbox-oauth.test.ts packages/core/src/sync/oauth/dropbox.test.ts
cp packages/core/src/sync/onedrive-oauth.test.ts packages/core/src/sync/oauth/onedrive.test.ts

# config/
cp packages/core/src/sync/sync-config.test.ts packages/core/src/sync/config/

# blob/
cp packages/core/src/sync/vault-blob.test.ts packages/core/src/sync/blob/

# lifecycle/
cp packages/core/src/sync/restore.test.ts packages/core/src/sync/lifecycle/
cp packages/core/src/sync/check-cloud-conflict.test.ts packages/core/src/sync/lifecycle/
cp packages/core/src/sync/sync-lifecycle.test.ts packages/core/src/sync/lifecycle/
```

- [ ] **Step 2: Update imports in each moved test file**

For each test, update relative imports to match the new depth. Common patterns:
- `'./types.js'` in core tests stays same
- `'./memory-adapter.js'` in core tests becomes `'../adapters/memory-adapter.js'`
- `'./vault-blob.js'` in core tests becomes `'../blob/vault-blob.js'`
- `'./errors.js'` in adapter tests becomes `'../core/errors.js'`
- `'./oauth.js'` in OAuth tests becomes `'./oauth-client.js'` or `'./pkce.js'`
- `'../crypto/*'` becomes `'../../crypto/*'` for files one level deeper

- [ ] **Step 3: Run tests from new locations**

Run: `pnpm --filter @keykeykey/core test`
Expected: Tests pass from both old and new locations.

- [ ] **Step 4: Delete old test files**

Remove all `sync/*.test.ts` files (but NOT `sync/connect.test.ts` and `sync/delete-cloud-vault.test.ts` which stay at top level).

- [ ] **Step 5: Run tests again**

Run: `pnpm --filter @keykeykey/core test`
Expected: All tests pass from new locations only.

- [ ] **Step 6: Commit**

```bash
git add -A packages/core/src/sync/
git commit -m "refactor(core/sync): move test files to match sub-module structure"
```

---

### Task 11: Delete shim files and finalize

**Files:** All shim files, final `sync/index.ts`

- [ ] **Step 1: Delete all shim files**

Remove old source files that are now just re-export shims:
`types.ts`, `errors.ts`, `merge.ts`, `tombstone.ts`, `vault-blob.ts`, `sync-engine.ts`, `memory-adapter.ts`, `webdav-adapter.ts`, `google-drive-adapter.ts`, `dropbox-adapter.ts`, `onedrive-adapter.ts`, `fetch-with-retry.ts`, `oauth.ts`, `google-oauth.ts`, `dropbox-oauth.ts`, `onedrive-oauth.ts`, `sync-config.ts`, `sync-lifecycle.ts`, `restore.ts`, `check-cloud-conflict.ts`

- [ ] **Step 2: Write final sync/index.ts**

Rewrite to import exclusively from sub-modules. All old shim paths are gone, only `./core/*`, `./adapters/*`, `./oauth/*`, `./config/*`, `./lifecycle/*`, `./blob/*`, `./connect.js`, `./delete-cloud-vault.js` remain.

Ensure every symbol currently exported by the module is still exported (check against the spec's Public API section).

- [ ] **Step 3: Run tests**

Run: `pnpm --filter @keykeykey/core test`
Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add -A packages/core/src/sync/
git commit -m "refactor(core/sync): remove shim files and finalize sub-module facade"
```

---

### Task 12: Build and full verification

- [ ] **Step 1: Build core**

Run: `pnpm --filter @keykeykey/core build`
Expected: tsup builds successfully.

- [ ] **Step 2: Build all packages**

Run: `pnpm build`
Expected: All packages build. Consumer apps resolve `@keykeykey/core/sync`.

- [ ] **Step 3: Run all tests**

Run: `pnpm test`
Expected: All tests pass across all packages.

- [ ] **Step 4: Run E2E critical tests**

Run: `cd e2e && npx playwright test --grep @critical`
Expected: All critical E2E tests pass.

- [ ] **Step 5: Rebuild the application**

Run: `pnpm build`
Expected: Clean build, ready to install/run.
