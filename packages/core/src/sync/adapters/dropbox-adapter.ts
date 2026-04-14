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
import { TemplateHttpAdapter } from './base-http-adapter.js';

const CONTENT_API = 'https://content.dropboxapi.com/2/files';
const RPC_API = 'https://api.dropboxapi.com/2/files';

/** Options for constructing a DropboxAdapter. */
export interface DropboxAdapterOptions {
  /** Called before every request to obtain a fresh OAuth2 access token. */
  getAccessToken: () => Promise<string>;
}

export class DropboxAdapter extends TemplateHttpAdapter {
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
