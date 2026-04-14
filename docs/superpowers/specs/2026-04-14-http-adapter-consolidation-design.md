# HTTP Adapter Consolidation

**Date:** 2026-04-14
**Status:** Approved
**Scope:** Expand `BaseHttpAdapter` into a template method base class that provides all ISyncAdapter methods. The three cloud adapters (Google Drive, Dropbox, OneDrive) shrink to 4 primitives plus URL/path construction. WebDAV gets a minimal fix to use `fetchRetry` (currently bypasses it).

## Context

`packages/core/src/sync/adapters/base-http-adapter.ts` exists but is minimal — only `fetchRetry()` and a naive `checkAuth()`. All real logic is duplicated across four concrete adapters:

- **GoogleDriveAdapter** (~277 lines)
- **DropboxAdapter** (~232 lines)
- **OneDriveAdapter** (~187 lines)
- **WebDavAdapter** (~230 lines, bypasses `fetchRetry` entirely — bug)

The three cloud adapters share near-identical patterns for Bearer token auth, blob read/write/delete, listing by extension, and legacy manifest handling. WebDAV uses Basic auth and the WebDAV protocol (PROPFIND, MKCOL), so its semantics don't fit the same abstraction.

## Design

### 1. Interface changes

None. `ISyncAdapter` in `packages/core/src/sync/core/types.ts` keeps its 8 methods.

### 2. Expanded `BaseHttpAdapter`

`packages/core/src/sync/adapters/base-http-adapter.ts` becomes an abstract class that provides all ISyncAdapter methods and takes a `getAccessToken` callback for Bearer auth.

```ts
export interface BaseHttpAdapterOptions {
  getAccessToken?: () => Promise<string>;
  vaultBlobName?: string; // defaults to 'vault.enc'
  legacyManifestName?: string; // defaults to 'manifest.json'
  itemExtension?: string; // defaults to '.bin'
}

export abstract class BaseHttpAdapter implements ISyncAdapter {
  protected readonly getAccessToken?: () => Promise<string>;
  protected readonly vaultBlobName: string;
  protected readonly legacyManifestName: string;
  protected readonly itemExtension: string;

  constructor(options: BaseHttpAdapterOptions = {}) {
    this.getAccessToken = options.getAccessToken;
    this.vaultBlobName = options.vaultBlobName ?? 'vault.enc';
    this.legacyManifestName = options.legacyManifestName ?? 'manifest.json';
    this.itemExtension = options.itemExtension ?? '.bin';
  }

  // Abstract primitives — subclasses implement these
  protected abstract downloadBlob(path: string): Promise<Uint8Array | null>;
  protected abstract uploadBlob(path: string, data: Uint8Array): Promise<void>;
  protected abstract deleteBlob(path: string): Promise<void>;
  protected abstract listBlobsRaw(): Promise<string[]>;

  // Concrete ISyncAdapter implementations (template methods)
  async readVaultBlob(): Promise<Uint8Array | null> {
    return this.downloadBlob(this.vaultBlobName);
  }
  async writeVaultBlob(data: Uint8Array): Promise<void> {
    return this.uploadBlob(this.vaultBlobName, data);
  }
  async readItem(id: string): Promise<Uint8Array | null> {
    return this.downloadBlob(this.itemPath(id));
  }
  async writeItem(id: string, data: Uint8Array): Promise<void> {
    return this.uploadBlob(this.itemPath(id), data);
  }
  async deleteItem(id: string): Promise<void> {
    return this.deleteBlob(this.itemPath(id));
  }
  async listItems(): Promise<string[]> {
    const raw = await this.listBlobsRaw();
    return raw
      .filter((name) => name.endsWith(this.itemExtension))
      .map((name) => name.slice(0, -this.itemExtension.length));
  }
  async readLegacyManifest(): Promise<SyncManifest | null> {
    const bytes = await this.downloadBlob(this.legacyManifestName);
    if (!bytes) return null;
    try {
      return JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      return null;
    }
  }
  async deleteLegacyManifest(): Promise<void> {
    return this.deleteBlob(this.legacyManifestName);
  }

  // Helpers (overridable by subclasses if needed)
  protected itemPath(id: string): string {
    return `${id}${this.itemExtension}`;
  }
  protected async buildAuthHeaders(): Promise<Record<string, string>> {
    if (!this.getAccessToken) return {};
    const token = await this.getAccessToken();
    return { Authorization: `Bearer ${token}` };
  }

  // Existing helpers stay unchanged — fetchRetry wraps fetchWithRetry from
  // fetch-with-retry.ts, checkAuth throws SyncAuthError on 401/403
  protected async fetchRetry(
    input: RequestInfo | URL,
    init?: RequestInit,
    options?: FetchRetryOptions,
  ): Promise<Response>;
  protected checkAuth(res: Response): void;
}
```

### 3. Subclass primitives

Each cloud adapter shrinks to constructor + 4 primitives + URL/path helpers.

**GoogleDriveAdapter** (~100 lines, down from 277):

- `downloadBlob(name)` — find file ID via Drive query, GET content, return `Uint8Array` or `null` on 404
- `uploadBlob(name, data)` — multipart POST for new file, PATCH for update
- `deleteBlob(name)` — find file ID, DELETE, swallow 404, evict ID cache
- `listBlobsRaw()` — query appDataFolder for files, return names
- Keeps: `fileIdCache` Map, `sanitizeQueryName()`, `validateFileId()`, multipart boundary construction

**DropboxAdapter** (~110 lines, down from 232):

- `downloadBlob(path)` — POST content API with `Dropbox-API-Arg` header; treat 409 as not-found via `isNotFound()`
- `uploadBlob(path, data)` — POST content API with `overwrite` mode
- `deleteBlob(path)` — POST RPC `delete_v2`, swallow 409 not-found
- `listBlobsRaw()` — `list_folder` with cursor pagination (`list_folder/continue`)
- Overrides `itemPath(id)` to include leading path segment if needed
- Keeps: `isNotFound()` parsing `error_summary` and `.tag` fields

**OneDriveAdapter** (~90 lines, down from 187):

- `downloadBlob(path)` — GET `approot:/${path}:/content`, 404 → null
- `uploadBlob(path, data)` — PUT `approot:/${path}:/content`
- `deleteBlob(path)` — DELETE `approot:/${path}`, swallow 404
- `listBlobsRaw()` — GET `approot:/children`, follow `@odata.nextLink` pagination
- Keeps: approot URL construction

All three use `this.buildAuthHeaders()` for Bearer tokens.

### 4. WebDAV retry bug fix

`WebDavAdapter` currently calls raw `fetch` directly in `httpGet`, `httpPut`, `httpDelete`, `httpPropfind`. Replace each with `this.fetchRetry(...)`. This is a narrow, standalone fix — WebDAV does not adopt the template method primitives (Basic auth + WebDAV protocol differ too much).

### 5. Tests

**New** — `packages/core/src/sync/adapters/__tests__/base-http-adapter.test.ts`:

- Defines a `FakeCloudAdapter` subclass with an in-memory `Map<string, Uint8Array>` backing the 4 primitives
- Tests each ISyncAdapter method:
  - `readVaultBlob` calls `downloadBlob('vault.enc')`
  - `writeVaultBlob` calls `uploadBlob('vault.enc', data)`
  - `readItem('id')` calls `downloadBlob('id.bin')`
  - `writeItem('id', data)` calls `uploadBlob('id.bin', data)`
  - `deleteItem('id')` calls `deleteBlob('id.bin')`
  - `listItems` strips `.bin` suffix from raw results, filters out non-matching extensions
  - `readLegacyManifest` parses JSON from `manifest.json`, returns null if blob missing or JSON invalid
  - `deleteLegacyManifest` calls `deleteBlob('manifest.json')`
- Tests `buildAuthHeaders` returns `Authorization: Bearer <token>` when `getAccessToken` is provided, empty object otherwise

**Existing** — `google-drive-adapter.test.ts`, `dropbox-adapter.test.ts`, `onedrive-adapter.test.ts` continue to test the public ISyncAdapter surface with mocked fetch. They should pass with minor tweaks as behavior is preserved.

**WebDAV** — add one test case verifying `fetchRetry` is used (mock fetch to fail once then succeed, assert it was called twice).

### 6. Out of scope

- No changes to WebDAV beyond the `fetchRetry` fix (no template method adoption, no Basic auth abstraction)
- No changes to `ISyncAdapter` interface
- No changes to `MemoryAdapter`
- No changes to OAuth helpers, token providers, or the `getAccessToken` callback contract
- No changes to `createAdapterFromConfig` in `sync/config/factory.ts`
- No shared test helpers extracted
- No new exports from `@keykeykey/core/sync` — `BaseHttpAdapter` stays internal
