/**
 * Abstract base class for HTTP-based sync adapters.
 *
 * Provides shared helpers: `fetchRetry` (wraps fetchWithRetry) and
 * `checkAuth` / `isNotFound` — common response predicates used by every
 * cloud adapter. Concrete adapters override `checkAuth` as needed.
 */

import type { ISyncAdapter, SyncManifest } from '../core/types.js';
import { SyncAuthError } from '../core/errors.js';
import { fetchWithRetry } from './fetch-with-retry.js';
import type { FetchRetryOptions } from './fetch-with-retry.js';

export abstract class BaseHttpAdapter implements ISyncAdapter {
  // ---------------------------------------------------------------------------
  // Shared helpers
  // ---------------------------------------------------------------------------

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

  // ---------------------------------------------------------------------------
  // Abstract ISyncAdapter methods
  // ---------------------------------------------------------------------------

  abstract readVaultBlob(): Promise<Uint8Array | null>;
  abstract writeVaultBlob(data: Uint8Array): Promise<void>;
  readLegacyManifest?(): Promise<SyncManifest | null>;
  deleteLegacyManifest?(): Promise<void>;
  abstract readItem(id: string): Promise<Uint8Array | null>;
  abstract writeItem(id: string, data: Uint8Array): Promise<void>;
  abstract deleteItem(id: string): Promise<void>;
  abstract listItems(): Promise<string[]>;
}
