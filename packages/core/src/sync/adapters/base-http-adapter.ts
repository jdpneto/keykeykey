/**
 * Base classes for HTTP-based sync adapters.
 *
 * `BaseHttpAdapter` provides shared helpers (`fetchRetry`, `checkAuth`) and
 * declares ISyncAdapter methods as abstract. Use this for HTTP adapters whose
 * protocol doesn't fit the blob-based template method pattern (e.g. WebDAV,
 * which uses PROPFIND/MKCOL and path-based URLs directly).
 *
 * `TemplateHttpAdapter` extends `BaseHttpAdapter` with concrete implementations
 * of all ISyncAdapter methods via a template method pattern: subclasses
 * implement 4 primitives (`downloadBlob`, `uploadBlob`, `deleteBlob`,
 * `listBlobsRaw`) and get the full ISyncAdapter contract for free. Use this
 * for cloud adapters that store blobs at paths (Google Drive, Dropbox,
 * OneDrive).
 */

import type { ISyncAdapter, SyncManifest } from '../core/types.js';
import { SyncAuthError } from '../core/errors.js';
import { fetchWithRetry } from './fetch-with-retry.js';
import type { FetchRetryOptions } from './fetch-with-retry.js';

// ---------------------------------------------------------------------------
// BaseHttpAdapter — shared helpers only
// ---------------------------------------------------------------------------

export abstract class BaseHttpAdapter implements ISyncAdapter {
  /**
   * Display name used in error messages (e.g. `'Dropbox'`, `'WebDAV'`).
   * Subclasses must implement so every thrown error names its provider.
   */
  protected abstract get providerName(): string;

  /** Wrapper around `fetchWithRetry` for use by subclasses. */
  protected fetchRetry(
    input: RequestInfo | URL,
    init?: RequestInit,
    options?: FetchRetryOptions,
  ): Promise<Response> {
    return fetchWithRetry(input, init, options);
  }

  /**
   * Whether `res` represents an auth failure that should surface as
   * `SyncAuthError`. Default: HTTP 401 or 403. Dropbox overrides to 401-only
   * because Dropbox uses 403 for non-auth errors.
   */
  protected isAuthFailure(res: { status: number }): boolean {
    return res.status === 401 || res.status === 403;
  }

  /** Throws `SyncAuthError` (named with `providerName`) when `isAuthFailure` matches. */
  protected checkAuth(res: {
    ok: boolean;
    status: number;
    statusText?: string;
    url?: string;
  }): void {
    if (this.isAuthFailure(res)) {
      throw new SyncAuthError(`${this.providerName} auth failed (HTTP ${res.status})`);
    }
  }

  /**
   * Throws a uniform `${providerName} ${opName} failed (HTTP X)` error if `res`
   * is not ok. Use after `checkAuth` for endpoints with no not-found semantic
   * (e.g. PUTs, after-the-fact GETs whose path was already resolved).
   */
  protected throwIfError(res: { ok: boolean; status: number }, opName: string): void {
    if (!res.ok) {
      throw new Error(`${this.providerName} ${opName} failed (HTTP ${res.status})`);
    }
  }

  // ISyncAdapter contract (subclasses implement)
  abstract readVaultBlob(): Promise<Uint8Array | null>;
  abstract writeVaultBlob(data: Uint8Array): Promise<void>;
  readLegacyManifest?(): Promise<SyncManifest | null>;
  deleteLegacyManifest?(): Promise<void>;
  abstract readItem(id: string): Promise<Uint8Array | null>;
  abstract writeItem(id: string, data: Uint8Array): Promise<void>;
  abstract deleteItem(id: string): Promise<void>;
  abstract listItems(): Promise<string[]>;
}

// ---------------------------------------------------------------------------
// TemplateHttpAdapter — template method pattern for blob-based storage
// ---------------------------------------------------------------------------

/** Options for constructing a TemplateHttpAdapter. */
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

export abstract class TemplateHttpAdapter extends BaseHttpAdapter {
  protected readonly getAccessToken?: () => Promise<string>;
  protected readonly vaultBlobName: string;
  protected readonly legacyManifestName: string;
  protected readonly itemExtension: string;

  constructor(options: BaseHttpAdapterOptions = {}) {
    super();
    this.getAccessToken = options.getAccessToken;
    this.vaultBlobName = options.vaultBlobName ?? 'vault.enc';
    this.legacyManifestName = options.legacyManifestName ?? 'manifest.json';
    this.itemExtension = options.itemExtension ?? '.bin';
  }

  // ---------------------------------------------------------------------------
  // Error-shape hooks — subclasses override to recognize provider-specific shapes
  // ---------------------------------------------------------------------------

  /**
   * Whether a non-ok response represents "blob does not exist." Default: HTTP
   * 404. Dropbox overrides for the `409 + body.error_summary contains
   * "not_found"` shape it uses across endpoints.
   *
   * Called by `handleNotFound` only on the `!res.ok` path; `body` is the
   * parsed JSON error body (or `{}` if parsing failed).
   */
  protected isNotFound(res: { status: number }, _body: Record<string, unknown>): boolean {
    return res.status === 404;
  }

  /**
   * Inspect a response and decide its disposition for endpoints that can
   * legitimately return "not found":
   *   - returns `false` when `res.ok` (caller should proceed to read the body)
   *   - returns `true` when `res` is a recognized not-found (caller should
   *     return `null` / `[]` / treat as already-deleted)
   *   - throws `SyncAuthError` on auth failure
   *   - throws a generic `${providerName} ${opName} failed` error otherwise
   *
   * Body is read at most once and only on the error path, so the caller is
   * still free to consume `res.arrayBuffer()` / `res.json()` after a `false`
   * return.
   */
  protected async handleNotFound(res: Response, opName: string): Promise<boolean> {
    this.checkAuth(res);
    if (res.ok) return false;
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (this.isNotFound(res, body)) return true;
    throw new Error(`${this.providerName} ${opName} failed (HTTP ${res.status})`);
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

  override async readLegacyManifest(): Promise<SyncManifest | null> {
    const bytes = await this.downloadBlob(this.legacyManifestName);
    if (!bytes) return null;
    try {
      return JSON.parse(new TextDecoder().decode(bytes)) as SyncManifest;
    } catch {
      return null;
    }
  }

  override async deleteLegacyManifest(): Promise<void> {
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
}
