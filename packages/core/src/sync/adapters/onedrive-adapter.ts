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
