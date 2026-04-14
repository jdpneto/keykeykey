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
