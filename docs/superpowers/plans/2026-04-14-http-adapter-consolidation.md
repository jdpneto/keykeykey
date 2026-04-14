# HTTP Adapter Consolidation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand `BaseHttpAdapter` into a template method base class providing all ISyncAdapter methods; shrink the 3 cloud adapters (Google Drive, Dropbox, OneDrive) to just 4 primitives; fix WebDAV's `fetchRetry` bypass bug.

**Architecture:** `BaseHttpAdapter` gains concrete implementations of `readVaultBlob`, `writeVaultBlob`, `readItem`, `writeItem`, `deleteItem`, `listItems`, `readLegacyManifest`, `deleteLegacyManifest` that delegate to 4 abstract primitives: `downloadBlob`, `uploadBlob`, `deleteBlob`, `listBlobsRaw`. A `buildAuthHeaders()` helper centralizes Bearer token construction. WebDAV doesn't adopt the primitives (protocol too different) but gets a minimal retry fix.

**Tech Stack:** TypeScript, Vitest

---

## File Map

| Action | File                                                                  | Responsibility                                           |
| ------ | --------------------------------------------------------------------- | -------------------------------------------------------- |
| Modify | `packages/core/src/sync/adapters/base-http-adapter.ts`                | Template method base class with all ISyncAdapter methods |
| Create | `packages/core/src/sync/adapters/__tests__/base-http-adapter.test.ts` | Tests using FakeCloudAdapter subclass                    |
| Modify | `packages/core/src/sync/adapters/onedrive-adapter.ts`                 | Shrink to 4 primitives + URL construction                |
| Modify | `packages/core/src/sync/adapters/dropbox-adapter.ts`                  | Shrink to 4 primitives + Dropbox error handling          |
| Modify | `packages/core/src/sync/adapters/google-drive-adapter.ts`             | Shrink to 4 primitives + file ID cache                   |
| Modify | `packages/core/src/sync/adapters/webdav-adapter.ts`                   | Replace raw `fetch` calls with `this.fetchRetry`         |

---

### Task 1: Expand BaseHttpAdapter with template methods

**Files:**

- Modify: `packages/core/src/sync/adapters/base-http-adapter.ts`
- Create: `packages/core/src/sync/adapters/__tests__/base-http-adapter.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/sync/adapters/__tests__/base-http-adapter.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { BaseHttpAdapter } from '../base-http-adapter.js';

/**
 * In-memory fake adapter for testing BaseHttpAdapter's concrete methods.
 * Subclasses only need to implement the 4 primitives.
 */
class FakeCloudAdapter extends BaseHttpAdapter {
  public blobs = new Map<string, Uint8Array>();
  public deletedPaths: string[] = [];

  protected async downloadBlob(path: string): Promise<Uint8Array | null> {
    return this.blobs.get(path) ?? null;
  }
  protected async uploadBlob(path: string, data: Uint8Array): Promise<void> {
    this.blobs.set(path, new Uint8Array(data));
  }
  protected async deleteBlob(path: string): Promise<void> {
    this.deletedPaths.push(path);
    this.blobs.delete(path);
  }
  protected async listBlobsRaw(): Promise<string[]> {
    return [...this.blobs.keys()];
  }
}

describe('BaseHttpAdapter', () => {
  describe('vault blob', () => {
    it('readVaultBlob returns null when no blob saved', async () => {
      const adapter = new FakeCloudAdapter();
      expect(await adapter.readVaultBlob()).toBeNull();
    });

    it('writeVaultBlob then readVaultBlob round-trips data', async () => {
      const adapter = new FakeCloudAdapter();
      const data = new Uint8Array([1, 2, 3, 4]);
      await adapter.writeVaultBlob(data);
      const result = await adapter.readVaultBlob();
      expect(result).not.toBeNull();
      expect(Array.from(result!)).toEqual([1, 2, 3, 4]);
    });

    it('uses vault.enc as default blob name', async () => {
      const adapter = new FakeCloudAdapter();
      await adapter.writeVaultBlob(new Uint8Array([1]));
      expect(adapter.blobs.has('vault.enc')).toBe(true);
    });

    it('respects custom vaultBlobName option', async () => {
      class CustomAdapter extends FakeCloudAdapter {
        constructor() {
          super({ vaultBlobName: '/custom/vault.bin' });
        }
      }
      const adapter = new CustomAdapter();
      await adapter.writeVaultBlob(new Uint8Array([1]));
      expect(adapter.blobs.has('/custom/vault.bin')).toBe(true);
    });
  });

  describe('items', () => {
    it('writeItem then readItem round-trips data', async () => {
      const adapter = new FakeCloudAdapter();
      const data = new Uint8Array([5, 6, 7]);
      await adapter.writeItem('abc', data);
      const result = await adapter.readItem('abc');
      expect(result).not.toBeNull();
      expect(Array.from(result!)).toEqual([5, 6, 7]);
    });

    it('readItem returns null for missing item', async () => {
      const adapter = new FakeCloudAdapter();
      expect(await adapter.readItem('missing')).toBeNull();
    });

    it('writeItem uses ${id}.bin as default path', async () => {
      const adapter = new FakeCloudAdapter();
      await adapter.writeItem('abc', new Uint8Array([1]));
      expect(adapter.blobs.has('abc.bin')).toBe(true);
    });

    it('deleteItem calls deleteBlob with ${id}.bin', async () => {
      const adapter = new FakeCloudAdapter();
      await adapter.writeItem('abc', new Uint8Array([1]));
      await adapter.deleteItem('abc');
      expect(adapter.deletedPaths).toEqual(['abc.bin']);
      expect(adapter.blobs.has('abc.bin')).toBe(false);
    });

    it('listItems strips .bin extension', async () => {
      const adapter = new FakeCloudAdapter();
      await adapter.writeItem('one', new Uint8Array([1]));
      await adapter.writeItem('two', new Uint8Array([2]));
      const ids = await adapter.listItems();
      expect(ids.sort()).toEqual(['one', 'two']);
    });

    it('listItems filters out non-matching extensions', async () => {
      class CustomAdapter extends FakeCloudAdapter {
        async seedRaw(name: string, data: Uint8Array) {
          this.blobs.set(name, data);
        }
      }
      const adapter = new CustomAdapter();
      await adapter.seedRaw('file.bin', new Uint8Array([1]));
      await adapter.seedRaw('file.txt', new Uint8Array([1]));
      await adapter.seedRaw('vault.enc', new Uint8Array([1]));
      const ids = await adapter.listItems();
      expect(ids).toEqual(['file']);
    });

    it('respects custom itemExtension', async () => {
      class CustomAdapter extends FakeCloudAdapter {
        constructor() {
          super({ itemExtension: '.dat' });
        }
      }
      const adapter = new CustomAdapter();
      await adapter.writeItem('abc', new Uint8Array([1]));
      expect(adapter.blobs.has('abc.dat')).toBe(true);
      const ids = await adapter.listItems();
      expect(ids).toEqual(['abc']);
    });

    it('custom itemPath override changes item placement', async () => {
      class CustomAdapter extends FakeCloudAdapter {
        protected override itemPath(id: string): string {
          return '/items/' + id + this.itemExtension;
        }
      }
      const adapter = new CustomAdapter();
      await adapter.writeItem('abc', new Uint8Array([1]));
      expect(adapter.blobs.has('/items/abc.bin')).toBe(true);
    });
  });

  describe('legacy manifest', () => {
    it('readLegacyManifest returns null when blob missing', async () => {
      const adapter = new FakeCloudAdapter();
      expect(await adapter.readLegacyManifest!()).toBeNull();
    });

    it('readLegacyManifest parses JSON from manifest.json blob', async () => {
      const adapter = new FakeCloudAdapter();
      const manifest = { version: 1, items: [{ id: 'a', updatedAt: 't1' }] };
      const bytes = new TextEncoder().encode(JSON.stringify(manifest));
      adapter.blobs.set('manifest.json', bytes);
      const result = await adapter.readLegacyManifest!();
      expect(result).toEqual(manifest);
    });

    it('readLegacyManifest returns null on invalid JSON', async () => {
      const adapter = new FakeCloudAdapter();
      adapter.blobs.set('manifest.json', new TextEncoder().encode('not json'));
      expect(await adapter.readLegacyManifest!()).toBeNull();
    });

    it('deleteLegacyManifest calls deleteBlob with manifest.json', async () => {
      const adapter = new FakeCloudAdapter();
      await adapter.deleteLegacyManifest!();
      expect(adapter.deletedPaths).toEqual(['manifest.json']);
    });
  });

  describe('buildAuthHeaders', () => {
    it('returns empty object when no getAccessToken provided', async () => {
      class TestAdapter extends FakeCloudAdapter {
        async headers() {
          return this.buildAuthHeaders();
        }
      }
      const adapter = new TestAdapter();
      expect(await adapter.headers()).toEqual({});
    });

    it('returns Bearer header when getAccessToken provided', async () => {
      class TestAdapter extends FakeCloudAdapter {
        constructor() {
          super({ getAccessToken: async () => 'my-token' });
        }
        async headers() {
          return this.buildAuthHeaders();
        }
      }
      const adapter = new TestAdapter();
      expect(await adapter.headers()).toEqual({ Authorization: 'Bearer my-token' });
    });

    it('calls getAccessToken fresh on each call', async () => {
      const getAccessToken = vi
        .fn()
        .mockResolvedValueOnce('token-1')
        .mockResolvedValueOnce('token-2');
      class TestAdapter extends FakeCloudAdapter {
        constructor() {
          super({ getAccessToken });
        }
        async headers() {
          return this.buildAuthHeaders();
        }
      }
      const adapter = new TestAdapter();
      expect(await adapter.headers()).toEqual({ Authorization: 'Bearer token-1' });
      expect(await adapter.headers()).toEqual({ Authorization: 'Bearer token-2' });
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @keykeykey/core test -- --testPathPattern base-http-adapter
```

Expected: Many failures — `BaseHttpAdapter` can't be instantiated as a non-abstract subclass because `downloadBlob`/`uploadBlob`/`deleteBlob`/`listBlobsRaw` don't exist yet, and `BaseHttpAdapterOptions` doesn't exist, and `itemPath`/`buildAuthHeaders` don't exist.

- [ ] **Step 3: Rewrite BaseHttpAdapter**

Replace the entire contents of `packages/core/src/sync/adapters/base-http-adapter.ts`:

```ts
/**
 * Abstract base class for HTTP-based sync adapters.
 *
 * Provides concrete implementations of all ISyncAdapter methods via a template
 * method pattern: subclasses implement 4 primitives (`downloadBlob`,
 * `uploadBlob`, `deleteBlob`, `listBlobsRaw`) and get the full ISyncAdapter
 * contract for free.
 *
 * Also provides shared helpers: `fetchRetry` (wraps fetchWithRetry),
 * `checkAuth` (throws on 401/403), and `buildAuthHeaders` (Bearer token
 * construction).
 */

import type { ISyncAdapter, SyncManifest } from '../core/types.js';
import { SyncAuthError } from '../core/errors.js';
import { fetchWithRetry } from './fetch-with-retry.js';
import type { FetchRetryOptions } from './fetch-with-retry.js';

/** Options for constructing a BaseHttpAdapter. */
export interface BaseHttpAdapterOptions {
  /** Optional async provider for Bearer auth tokens. */
  getAccessToken?: () => Promise<string>;
  /** Path/name of the vault blob. Defaults to `'vault.enc'`. */
  vaultBlobName?: string;
  /** Path/name of the legacy manifest blob. Defaults to `'manifest.json'`. */
  legacyManifestName?: string;
  /** File extension used for items. Defaults to `'.bin'`. */
  itemExtension?: string;
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

  // ---------------------------------------------------------------------------
  // Abstract primitives — subclasses implement these
  // ---------------------------------------------------------------------------

  /** Download raw bytes from `path`. Return `null` if the blob does not exist. */
  protected abstract downloadBlob(path: string): Promise<Uint8Array | null>;

  /** Upload raw bytes to `path`, creating or replacing. */
  protected abstract uploadBlob(path: string, data: Uint8Array): Promise<void>;

  /** Delete blob at `path`. Should not throw if the blob is already absent. */
  protected abstract deleteBlob(path: string): Promise<void>;

  /** List the raw names of all blobs in the item storage location. */
  protected abstract listBlobsRaw(): Promise<string[]>;

  // ---------------------------------------------------------------------------
  // Concrete ISyncAdapter implementations (template methods)
  // ---------------------------------------------------------------------------

  async readVaultBlob(): Promise<Uint8Array | null> {
    return this.downloadBlob(this.vaultBlobName);
  }

  async writeVaultBlob(data: Uint8Array): Promise<void> {
    await this.uploadBlob(this.vaultBlobName, data);
  }

  async readItem(id: string): Promise<Uint8Array | null> {
    return this.downloadBlob(this.itemPath(id));
  }

  async writeItem(id: string, data: Uint8Array): Promise<void> {
    await this.uploadBlob(this.itemPath(id), data);
  }

  async deleteItem(id: string): Promise<void> {
    await this.deleteBlob(this.itemPath(id));
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
      return JSON.parse(new TextDecoder().decode(bytes)) as SyncManifest;
    } catch {
      return null;
    }
  }

  async deleteLegacyManifest(): Promise<void> {
    await this.deleteBlob(this.legacyManifestName);
  }

  // ---------------------------------------------------------------------------
  // Protected helpers
  // ---------------------------------------------------------------------------

  /**
   * Build the `${id}.bin` path for an item. Subclasses can override to add
   * folder prefixes (e.g. Dropbox uses `/items/${id}.bin`).
   */
  protected itemPath(id: string): string {
    return id + this.itemExtension;
  }

  /** Build Bearer auth headers from the `getAccessToken` callback, if provided. */
  protected async buildAuthHeaders(): Promise<Record<string, string>> {
    if (!this.getAccessToken) return {};
    const token = await this.getAccessToken();
    return { Authorization: 'Bearer ' + token };
  }

  /** Wrapper around `fetchWithRetry` for use by subclasses. */
  protected fetchRetry(
    input: RequestInfo | URL,
    init?: RequestInit,
    options?: FetchRetryOptions,
  ): Promise<Response> {
    return fetchWithRetry(input, init, options);
  }

  /** Throws `SyncAuthError` if the response status is 401 or 403. */
  protected checkAuth(res: {
    ok: boolean;
    status: number;
    statusText?: string;
    url?: string;
  }): void {
    if (res.status === 401 || res.status === 403) {
      throw new SyncAuthError();
    }
  }
}
```

- [ ] **Step 4: Run tests**

Run:

```bash
pnpm --filter @keykeykey/core test -- --testPathPattern base-http-adapter
```

Expected: All tests pass.

- [ ] **Step 5: Verify existing tests still pass**

Run:

```bash
pnpm --filter @keykeykey/core test
```

Expected: All existing tests pass (or fail only with errors that are clearly related to the subclass implementations we haven't updated yet — those will be fixed in later tasks). In this task, the cloud adapters still extend `BaseHttpAdapter` without options, so `super()` with no args should still work since `options = {}` is the default.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/sync/adapters/base-http-adapter.ts packages/core/src/sync/adapters/__tests__/base-http-adapter.test.ts
git commit -m "feat(core/sync): expand BaseHttpAdapter with template methods for ISyncAdapter"
```

---

### Task 2: Refactor OneDriveAdapter to use template methods

**Files:**

- Modify: `packages/core/src/sync/adapters/onedrive-adapter.ts`

OneDrive layout:

- Vault: `approot:/vault.enc` (path = `vault.enc`)
- Items: `approot:/items/{id}.bin` (path = `items/{id}.bin`)

- [ ] **Step 1: Rewrite OneDriveAdapter**

Replace the contents of `packages/core/src/sync/adapters/onedrive-adapter.ts`:

```ts
/**
 * OneDrive sync adapter.
 *
 * Stores all vault files in the OneDrive app folder using the Microsoft Graph API v1.0.
 *
 * File layout:
 * - `approot:/vault.enc`        -- encrypted vault blob (raw bytes)
 * - `approot:/items/{id}.bin`   -- encrypted vault items (raw bytes)
 *
 * Auth is delegated to a `getAccessToken` callback supplied by the caller so
 * this module stays framework-agnostic (works in Expo, Tauri, and the browser
 * extension).
 */

import { SyncAuthError } from '../core/errors.js';
import { BaseHttpAdapter } from './base-http-adapter.js';

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0/me/drive/special/approot:';

/** Options for constructing an OneDriveAdapter. */
export interface OneDriveAdapterOptions {
  /** Called before every request to obtain a fresh OAuth2 access token. */
  getAccessToken: () => Promise<string>;
}

export class OneDriveAdapter extends BaseHttpAdapter {
  constructor(options: OneDriveAdapterOptions) {
    super({ getAccessToken: options.getAccessToken });
  }

  // ---------------------------------------------------------------------------
  // Primitives required by BaseHttpAdapter
  // ---------------------------------------------------------------------------

  protected async downloadBlob(path: string): Promise<Uint8Array | null> {
    const headers = await this.buildAuthHeaders();
    const res = await this.fetchRetry(GRAPH_BASE + '/' + path + ':/content', {
      method: 'GET',
      headers,
    });

    this.checkAuth(res);
    if (res.status === 404) return null;
    if (!res.ok) {
      throw new Error('OneDrive download failed (HTTP ' + res.status + ')');
    }
    return new Uint8Array(await res.arrayBuffer());
  }

  protected async uploadBlob(path: string, data: Uint8Array): Promise<void> {
    const headers = await this.buildAuthHeaders();
    const res = await this.fetchRetry(GRAPH_BASE + '/' + path + ':/content', {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/octet-stream' },
      body: data as BodyInit,
    });

    this.checkAuth(res);
    if (!res.ok) {
      throw new Error('OneDrive upload failed (HTTP ' + res.status + ')');
    }
  }

  protected async deleteBlob(path: string): Promise<void> {
    const headers = await this.buildAuthHeaders();
    const res = await this.fetchRetry(GRAPH_BASE + '/' + path + ':', {
      method: 'DELETE',
      headers,
    });

    this.checkAuth(res);
    if (res.status === 404) return; // already gone
    if (!res.ok) {
      throw new Error('OneDrive delete failed (HTTP ' + res.status + ')');
    }
  }

  protected async listBlobsRaw(): Promise<string[]> {
    const headers = await this.buildAuthHeaders();
    const res = await this.fetchRetry(GRAPH_BASE + '/items:/children', {
      method: 'GET',
      headers,
    });

    this.checkAuth(res);
    if (res.status === 404) return [];
    if (!res.ok) {
      throw new Error('OneDrive list failed (HTTP ' + res.status + ')');
    }

    const entries: Array<{ name: string; file?: unknown }> = [];
    let page = (await res.json()) as {
      value: Array<{ name: string; file?: unknown; folder?: unknown }>;
      '@odata.nextLink'?: string;
    };
    entries.push(...page.value);

    while (page['@odata.nextLink']) {
      const nextHeaders = await this.buildAuthHeaders();
      const nextRes = await this.fetchRetry(page['@odata.nextLink'], {
        method: 'GET',
        headers: nextHeaders,
      });
      if (!nextRes.ok) {
        throw new Error('OneDrive list (nextLink) failed (HTTP ' + nextRes.status + ')');
      }
      page = (await nextRes.json()) as {
        value: Array<{ name: string; file?: unknown; folder?: unknown }>;
        '@odata.nextLink'?: string;
      };
      entries.push(...page.value);
    }

    // Only keep files (not folders) — BaseHttpAdapter will filter by extension
    return entries.filter((e) => e.file !== undefined).map((e) => e.name);
  }

  // ---------------------------------------------------------------------------
  // Overrides
  // ---------------------------------------------------------------------------

  /** Items live in `items/{id}.bin` (under the approot). */
  protected override itemPath(id: string): string {
    return 'items/' + id + this.itemExtension;
  }

  /** OneDrive-flavored auth error message. */
  protected override checkAuth(res: {
    ok: boolean;
    status: number;
    statusText?: string;
    url?: string;
  }): void {
    if (res.status === 401 || res.status === 403) {
      throw new SyncAuthError('OneDrive auth failed (HTTP ' + res.status + ')');
    }
  }
}
```

- [ ] **Step 2: Run OneDrive tests**

Run:

```bash
pnpm --filter @keykeykey/core test -- --testPathPattern onedrive-adapter
```

Expected: All OneDrive adapter tests pass. The behavior is identical — just restructured through template methods.

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/sync/adapters/onedrive-adapter.ts
git commit -m "refactor(core/sync): shrink OneDriveAdapter to 4 primitives via BaseHttpAdapter"
```

---

### Task 3: Refactor DropboxAdapter to use template methods

**Files:**

- Modify: `packages/core/src/sync/adapters/dropbox-adapter.ts`

Dropbox layout:

- Vault: `/vault.enc` (path uses leading `/`)
- Items: `/items/{id}.bin`
- Legacy manifest: `/manifest.json`

Dropbox quirks:

- POST for everything (downloads too, via `Dropbox-API-Arg` header)
- 409 = "not found" (not 404)
- Delete uses a separate RPC endpoint with JSON body
- List uses cursor pagination

- [ ] **Step 1: Rewrite DropboxAdapter**

Replace the contents of `packages/core/src/sync/adapters/dropbox-adapter.ts`:

```ts
/**
 * Dropbox sync adapter.
 *
 * Stores all vault files in the Dropbox app folder using the Dropbox API v2.
 *
 * File layout:
 * - `/vault.enc`        -- encrypted vault blob (raw bytes)
 * - `/items/{id}.bin`   -- encrypted vault items (raw bytes)
 *
 * Auth is delegated to a `getAccessToken` callback supplied by the caller so
 * this module stays framework-agnostic (works in Expo, Tauri, and the browser
 * extension).
 */

import { SyncAuthError } from '../core/errors.js';
import { BaseHttpAdapter } from './base-http-adapter.js';

const CONTENT_API = 'https://content.dropboxapi.com/2/files';
const RPC_API = 'https://api.dropboxapi.com/2/files';

/** Options for constructing a DropboxAdapter. */
export interface DropboxAdapterOptions {
  /** Called before every request to obtain a fresh OAuth2 access token. */
  getAccessToken: () => Promise<string>;
}

export class DropboxAdapter extends BaseHttpAdapter {
  constructor(options: DropboxAdapterOptions) {
    super({
      getAccessToken: options.getAccessToken,
      vaultBlobName: '/vault.enc',
      legacyManifestName: '/manifest.json',
    });
  }

  // ---------------------------------------------------------------------------
  // Primitives required by BaseHttpAdapter
  // ---------------------------------------------------------------------------

  protected async downloadBlob(path: string): Promise<Uint8Array | null> {
    const headers = await this.buildAuthHeaders();
    const res = await this.fetchRetry(CONTENT_API + '/download', {
      method: 'POST',
      headers: { ...headers, 'Dropbox-API-Arg': JSON.stringify({ path }) },
    });

    this.checkAuth(res);
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as {
        error_summary?: string;
        error?: { '.tag'?: string };
      };
      if (this.isNotFound(res.status, body)) return null;
      throw new Error('Dropbox download failed (HTTP ' + res.status + ')');
    }
    return new Uint8Array(await res.arrayBuffer());
  }

  protected async uploadBlob(path: string, data: Uint8Array): Promise<void> {
    const headers = await this.buildAuthHeaders();
    const res = await this.fetchRetry(CONTENT_API + '/upload', {
      method: 'POST',
      headers: {
        ...headers,
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
      throw new Error('Dropbox upload failed (HTTP ' + res.status + ')');
    }
  }

  protected async deleteBlob(path: string): Promise<void> {
    const headers = await this.buildAuthHeaders();
    const res = await this.fetchRetry(RPC_API + '/delete_v2', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ path }),
    });

    this.checkAuth(res);
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as {
        error_summary?: string;
        error?: { '.tag'?: string };
      };
      if (this.isNotFound(res.status, body)) return; // already gone
      throw new Error('Dropbox delete failed (HTTP ' + res.status + ')');
    }
  }

  protected async listBlobsRaw(): Promise<string[]> {
    const headers = await this.buildAuthHeaders();
    const res = await this.fetchRetry(RPC_API + '/list_folder', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: '/items' }),
    });

    this.checkAuth(res);
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as {
        error_summary?: string;
        error?: { '.tag'?: string };
      };
      if (this.isNotFound(res.status, body)) return [];
      throw new Error('Dropbox list_folder failed (HTTP ' + res.status + ')');
    }

    const entries: Array<{ '.tag': string; name: string }> = [];
    let page = (await res.json()) as {
      entries: Array<{ '.tag': string; name: string }>;
      has_more: boolean;
      cursor: string;
    };
    entries.push(...page.entries);

    while (page.has_more) {
      const continueHeaders = await this.buildAuthHeaders();
      const continueRes = await this.fetchRetry(RPC_API + '/list_folder/continue', {
        method: 'POST',
        headers: { ...continueHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ cursor: page.cursor }),
      });
      if (!continueRes.ok) {
        throw new Error('Dropbox list_folder/continue failed (HTTP ' + continueRes.status + ')');
      }
      page = (await continueRes.json()) as {
        entries: Array<{ '.tag': string; name: string }>;
        has_more: boolean;
        cursor: string;
      };
      entries.push(...page.entries);
    }

    // Only keep files (not folders) — BaseHttpAdapter will filter by extension
    return entries.filter((e) => e['.tag'] === 'file').map((e) => e.name);
  }

  // ---------------------------------------------------------------------------
  // Overrides
  // ---------------------------------------------------------------------------

  /** Items live at `/items/{id}.bin`. */
  protected override itemPath(id: string): string {
    return '/items/' + id + this.itemExtension;
  }

  /** Dropbox-flavored auth error message. Only 401 indicates auth failure (403 is used for other errors). */
  protected override checkAuth(res: {
    ok: boolean;
    status: number;
    statusText?: string;
    url?: string;
  }): void {
    if (res.status === 401) {
      throw new SyncAuthError('Dropbox auth failed (HTTP ' + res.status + ')');
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Check if a failed response is a Dropbox "path not found" error.
   *
   * Dropbox returns HTTP 409 with varying error structures per endpoint.
   * The `error_summary` string (e.g. `"path/not_found/..."`) is the most
   * reliable field across all endpoints.
   */
  private isNotFound(
    status: number,
    body: { error_summary?: string; error?: { '.tag'?: string } },
  ): boolean {
    if (status !== 409) return false;
    if (body.error_summary?.includes('not_found')) return true;
    const tag = body.error?.['.tag'] ?? '';
    return tag === 'path/not_found' || tag.startsWith('path/not_found');
  }
}
```

- [ ] **Step 2: Run Dropbox tests**

Run:

```bash
pnpm --filter @keykeykey/core test -- --testPathPattern dropbox-adapter
```

Expected: All Dropbox adapter tests pass.

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/sync/adapters/dropbox-adapter.ts
git commit -m "refactor(core/sync): shrink DropboxAdapter to 4 primitives via BaseHttpAdapter"
```

---

### Task 4: Refactor GoogleDriveAdapter to use template methods

**Files:**

- Modify: `packages/core/src/sync/adapters/google-drive-adapter.ts`

Google Drive layout: flat files in appDataFolder (no subdirectories). Items are `{id}.bin`, vault blob is `vault.enc`, legacy manifest is `manifest.json`.

Complications:

- Drive uses file IDs (not paths) — needs to search for file name first
- Upload uses multipart POST for new files, PATCH for updates
- File ID cache must be maintained for performance

- [ ] **Step 1: Rewrite GoogleDriveAdapter**

Replace the contents of `packages/core/src/sync/adapters/google-drive-adapter.ts`:

```ts
/**
 * Google Drive sync adapter.
 *
 * Stores all vault files in the `appDataFolder` (hidden app-specific space)
 * using the Google Drive REST API v3.
 *
 * Auth is delegated to a `getAccessToken` callback supplied by the caller so
 * this module stays framework-agnostic (works in Expo, Tauri, and the browser
 * extension).
 */

import { SyncAuthError } from '../core/errors.js';
import { BaseHttpAdapter } from './base-http-adapter.js';

const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';

/** Options for constructing a GoogleDriveAdapter. */
export interface GoogleDriveAdapterOptions {
  /** Called before every request to obtain a fresh OAuth2 access token. */
  getAccessToken: () => Promise<string>;
}

/** Validate a Drive file ID contains only safe characters for URL interpolation. */
function validateFileId(id: string): void {
  if (!/^[A-Za-z0-9_-]+$/.test(id)) {
    throw new Error('Invalid Drive file ID received from API');
  }
}

/**
 * Sanitize a file-name string for embedding inside a Drive API query string.
 *
 * Drive's query language requires `\` -> `\\` and `'` -> `\'`.
 */
function sanitizeQueryName(name: string): string {
  return name.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

export class GoogleDriveAdapter extends BaseHttpAdapter {
  /** Cache: logical file name -> Drive file id. */
  private readonly fileIdCache = new Map<string, string>();

  constructor(options: GoogleDriveAdapterOptions) {
    super({ getAccessToken: options.getAccessToken });
  }

  // ---------------------------------------------------------------------------
  // Primitives required by BaseHttpAdapter
  // ---------------------------------------------------------------------------

  protected async downloadBlob(path: string): Promise<Uint8Array | null> {
    const fileId = await this.findFile(path);
    if (!fileId) return null;

    const headers = await this.buildAuthHeaders();
    const res = await this.fetchRetry(DRIVE_API + '/files/' + fileId + '?alt=media', {
      headers,
    });
    this.checkAuth(res);

    return new Uint8Array(await res.arrayBuffer());
  }

  protected async uploadBlob(path: string, data: Uint8Array): Promise<void> {
    await this.upsertFile(path, data, 'application/octet-stream');
  }

  protected async deleteBlob(path: string): Promise<void> {
    const fileId = await this.findFile(path);
    if (!fileId) return; // already gone

    const headers = await this.buildAuthHeaders();
    const res = await this.fetchRetry(DRIVE_API + '/files/' + fileId, {
      method: 'DELETE',
      headers,
    });
    this.checkAuth(res);

    this.fileIdCache.delete(path);
  }

  protected async listBlobsRaw(): Promise<string[]> {
    const headers = await this.buildAuthHeaders();
    const query = encodeURIComponent("name contains '.bin' and trashed=false");
    const res = await this.fetchRetry(
      DRIVE_API + '/files?spaces=appDataFolder&fields=files(id,name)&q=' + query,
      { headers },
    );
    this.checkAuth(res);

    const body = (await res.json()) as { files?: Array<{ id: string; name: string }> };
    return (body.files ?? []).map((f) => f.name);
  }

  // ---------------------------------------------------------------------------
  // Overrides
  // ---------------------------------------------------------------------------

  /** Google Drive throws on all non-ok responses (stricter than base). */
  protected override checkAuth(res: {
    ok: boolean;
    status: number;
    statusText?: string;
    url?: string;
  }): void {
    if (res.status === 401 || res.status === 403) {
      throw new SyncAuthError('Google Drive auth failed (HTTP ' + res.status + ')');
    }
    if (!res.ok) {
      throw new Error('Google Drive request failed (HTTP ' + res.status + ')');
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Find a file by name in appDataFolder.
   * Returns the Drive file id, or null if not found.
   * Results are cached for the lifetime of this adapter instance.
   */
  private async findFile(name: string): Promise<string | null> {
    const cached = this.fileIdCache.get(name);
    if (cached !== undefined) return cached;

    const headers = await this.buildAuthHeaders();
    const safe = sanitizeQueryName(name);
    const query = encodeURIComponent("name='" + safe + "' and trashed=false");
    const res = await this.fetchRetry(
      DRIVE_API + '/files?spaces=appDataFolder&fields=files(id)&q=' + query,
      { headers },
    );
    this.checkAuth(res);

    const body = (await res.json()) as { files?: Array<{ id: string }> };
    const fileId = body.files?.[0]?.id ?? null;

    if (fileId) {
      validateFileId(fileId);
      this.fileIdCache.set(name, fileId);
    }
    return fileId;
  }

  /**
   * Create or update a file using multipart upload (POST) or media upload (PATCH).
   *
   * After a successful creation the new file id is stored in the cache.
   */
  private async upsertFile(name: string, data: Uint8Array, mimeType: string): Promise<void> {
    const existingId = await this.findFile(name);
    const headers = await this.buildAuthHeaders();

    if (existingId) {
      // PATCH -- update content only (metadata already set)
      const res = await this.fetchRetry(
        DRIVE_UPLOAD_API + '/files/' + existingId + '?uploadType=media',
        {
          method: 'PATCH',
          headers: { ...headers, 'Content-Type': mimeType },
          body: data as BodyInit,
        },
      );
      this.checkAuth(res);
    } else {
      // POST multipart -- create with metadata + content in one request
      const boundary = crypto.randomUUID();
      const encoder = new TextEncoder();

      const metadataPart = encoder.encode(
        '--' +
          boundary +
          '\r\n' +
          'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
          JSON.stringify({ name, parents: ['appDataFolder'] }) +
          '\r\n',
      );
      const dataPart = encoder.encode(
        '--' + boundary + '\r\nContent-Type: ' + mimeType + '\r\n\r\n',
      );
      const closing = encoder.encode('\r\n--' + boundary + '--');

      const body = new Uint8Array(
        metadataPart.length + dataPart.length + data.length + closing.length,
      );
      body.set(metadataPart, 0);
      body.set(dataPart, metadataPart.length);
      body.set(data, metadataPart.length + dataPart.length);
      body.set(closing, metadataPart.length + dataPart.length + data.length);

      const res = await this.fetchRetry(DRIVE_UPLOAD_API + '/files?uploadType=multipart', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'multipart/related; boundary=' + boundary },
        body,
      });
      this.checkAuth(res);

      const created = (await res.json()) as { id?: string };
      if (created.id) {
        validateFileId(created.id);
        this.fileIdCache.set(name, created.id);
      }
    }
  }
}
```

- [ ] **Step 2: Run Google Drive tests**

Run:

```bash
pnpm --filter @keykeykey/core test -- --testPathPattern google-drive-adapter
```

Expected: All Google Drive adapter tests pass.

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/sync/adapters/google-drive-adapter.ts
git commit -m "refactor(core/sync): shrink GoogleDriveAdapter to 4 primitives via BaseHttpAdapter"
```

---

### Task 5: Fix WebDAV to use fetchRetry

**Files:**

- Modify: `packages/core/src/sync/adapters/webdav-adapter.ts`

WebDAV currently uses raw `fetch()` in 5 places (lines 133, 180, 193, 200, 207). Replace each with `this.fetchRetry()` so retry-with-backoff works. No other changes.

- [ ] **Step 1: Update `ensureDir` helper**

In `packages/core/src/sync/adapters/webdav-adapter.ts`, replace lines 128-148 (the `ensureDir` method). Find:

```ts
  private async ensureDir(url: string): Promise<void> {
    if (this.ensuredDirs.has(url)) return;
    // Ensure trailing slash -- Apache redirects /dir to /dir/ on MKCOL,
    // and the browser strips the Authorization header on redirect.
    const dirUrl = url.endsWith('/') ? url : url + '/';
    const res = await fetch(dirUrl, {
      method: 'MKCOL',
      headers: { Authorization: this.authHeader },
    });
```

Replace `await fetch(dirUrl, ...)` with `await this.fetchRetry(dirUrl, ...)`:

```ts
  private async ensureDir(url: string): Promise<void> {
    if (this.ensuredDirs.has(url)) return;
    // Ensure trailing slash -- Apache redirects /dir to /dir/ on MKCOL,
    // and the browser strips the Authorization header on redirect.
    const dirUrl = url.endsWith('/') ? url : url + '/';
    const res = await this.fetchRetry(dirUrl, {
      method: 'MKCOL',
      headers: { Authorization: this.authHeader },
    });
```

- [ ] **Step 2: Update httpGet**

Replace `httpGet` method (currently at lines 179-185):

```ts
  private httpGet(url: string): Promise<Response> {
    return this.fetchRetry(url, {
      method: 'GET',
      headers: { Authorization: this.authHeader },
      cache: 'no-store' as RequestCache,
    });
  }
```

- [ ] **Step 3: Update httpPut**

Replace `httpPut` method (currently at lines 187-197):

```ts
  private httpPut(
    url: string,
    body: string | Uint8Array,
    extraHeaders: Record<string, string> = {},
  ): Promise<Response> {
    return this.fetchRetry(url, {
      method: 'PUT',
      headers: { Authorization: this.authHeader, ...extraHeaders },
      body: body as BodyInit,
    });
  }
```

- [ ] **Step 4: Update httpDelete**

Replace `httpDelete` method (currently at lines 199-204):

```ts
  private httpDelete(url: string): Promise<Response> {
    return this.fetchRetry(url, {
      method: 'DELETE',
      headers: { Authorization: this.authHeader },
    });
  }
```

- [ ] **Step 5: Update httpPropfind**

Replace `httpPropfind` method (currently at lines 206-211):

```ts
  private httpPropfind(url: string, depth: '0' | '1'): Promise<Response> {
    return this.fetchRetry(url, {
      method: 'PROPFIND',
      headers: { Authorization: this.authHeader, Depth: depth },
    });
  }
```

- [ ] **Step 6: Run WebDAV tests**

Run:

```bash
pnpm --filter @keykeykey/core test -- --testPathPattern webdav-adapter
```

Expected: All existing WebDAV adapter tests pass.

- [ ] **Step 7: Add a retry verification test**

Open `packages/core/src/sync/adapters/webdav-adapter.test.ts`. At the end of the main `describe` block, add:

```ts
it('retries failed requests via fetchRetry', async () => {
  let callCount = 0;
  const fetchMock = vi.fn(async () => {
    callCount++;
    if (callCount === 1) {
      // First call: network error that fetchWithRetry treats as retryable
      throw new TypeError('network');
    }
    return new Response(null, { status: 404 });
  });
  vi.stubGlobal('fetch', fetchMock);

  const adapter = new WebDavAdapter({
    url: 'https://example.com/webdav',
    username: 'user',
    password: 'pass',
  });
  const result = await adapter.readVaultBlob();

  expect(result).toBeNull();
  expect(callCount).toBeGreaterThanOrEqual(2);
  vi.unstubAllGlobals();
});
```

If the retry test needs imports (`vi`, `WebDavAdapter`) that aren't already imported, add them at the top of the file.

- [ ] **Step 8: Run the new test**

Run:

```bash
pnpm --filter @keykeykey/core test -- --testPathPattern webdav-adapter
```

Expected: All tests pass including the new retry test.

- [ ] **Step 9: Commit**

```bash
git add packages/core/src/sync/adapters/webdav-adapter.ts packages/core/src/sync/adapters/__tests__/webdav-adapter.test.ts
git commit -m "fix(core/sync): WebDAV adapter now uses fetchRetry for retry resilience"
```

---

### Task 6: Full test suite and verification

**Files:** None (verification only)

- [ ] **Step 1: Build core**

Run:

```bash
pnpm --filter @keykeykey/core build
```

Expected: Clean build.

- [ ] **Step 2: Run core tests**

Run:

```bash
pnpm --filter @keykeykey/core test
```

Expected: All tests pass (core tests include ~776 existing + new BaseHttpAdapter tests).

- [ ] **Step 3: Run all tests**

Run:

```bash
pnpm test
```

Expected: All tests across all packages pass.

- [ ] **Step 4: Run lint and format check**

Run:

```bash
pnpm lint && pnpm format:check
```

Expected: No errors. If format issues:

```bash
pnpm format
git add -u
git commit -m "style: fix prettier formatting"
```

- [ ] **Step 5: Run critical E2E tests**

Run:

```bash
cd e2e && npx playwright test --grep @critical
```

Expected: Critical E2E tests pass (sync behavior is unchanged, just internally restructured).
