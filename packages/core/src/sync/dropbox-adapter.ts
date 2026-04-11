/**
 * Dropbox sync adapter.
 *
 * Stores all vault files in the Dropbox app folder using the Dropbox API v2.
 *
 * File layout:
 * - `/vault.enc`        — encrypted vault blob (raw bytes)
 * - `/items/{id}.bin`   — encrypted vault items (raw bytes)
 *
 * Auth is delegated to a `getAccessToken` callback supplied by the caller so
 * this module stays framework-agnostic (works in Expo, Tauri, and the browser
 * extension).
 */

import type { ISyncAdapter } from './types.js';
import { SyncAuthError } from './errors.js';
import { fetchWithRetry } from './fetch-with-retry.js';

const CONTENT_API = 'https://content.dropboxapi.com/2/files';
const RPC_API = 'https://api.dropboxapi.com/2/files';

/** Options for constructing a DropboxAdapter. */
export interface DropboxAdapterOptions {
  /** Called before every request to obtain a fresh OAuth2 access token. */
  getAccessToken: () => Promise<string>;
}

/**
 * Sync adapter backed by the Dropbox app folder.
 *
 * File layout:
 * - `/vault.enc`      — encrypted vault blob (raw bytes)
 * - `/items/{id}.bin` — encrypted vault items (raw bytes)
 */
export class DropboxAdapter implements ISyncAdapter {
  private readonly getAccessToken: () => Promise<string>;

  constructor(options: DropboxAdapterOptions) {
    this.getAccessToken = options.getAccessToken;
  }

  // ---------------------------------------------------------------------------
  // ISyncAdapter implementation
  // ---------------------------------------------------------------------------

  async readVaultBlob(): Promise<Uint8Array | null> {
    return this.download('/vault.enc');
  }

  async writeVaultBlob(data: Uint8Array): Promise<void> {
    await this.upload('/vault.enc', data);
  }

  async readItem(id: string): Promise<Uint8Array | null> {
    return this.download(`/items/${id}.bin`);
  }

  async writeItem(id: string, data: Uint8Array): Promise<void> {
    await this.upload(`/items/${id}.bin`, data);
  }

  async deleteItem(id: string): Promise<void> {
    const token = await this.getAccessToken();
    const res = await fetchWithRetry(`${RPC_API}/delete_v2`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ path: `/items/${id}.bin` }),
    });

    this.checkAuth(res);
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as {
        error_summary?: string;
        error?: { '.tag'?: string };
      };
      if (this.isNotFound(res.status, body)) {
        return; // already gone — nothing to do
      }
      throw new Error(`Dropbox delete failed (HTTP ${res.status})`);
    }
  }

  async listItems(): Promise<string[]> {
    const token = await this.getAccessToken();
    const res = await fetchWithRetry(`${RPC_API}/list_folder`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ path: '/items' }),
    });

    this.checkAuth(res);
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as {
        error_summary?: string;
        error?: { '.tag'?: string };
      };
      if (this.isNotFound(res.status, body)) {
        return []; // folder doesn't exist yet
      }
      throw new Error(`Dropbox list_folder failed (HTTP ${res.status})`);
    }

    const entries: Array<{ '.tag': string; name: string }> = [];
    let page = (await res.json()) as {
      entries: Array<{ '.tag': string; name: string }>;
      has_more: boolean;
      cursor: string;
    };

    entries.push(...page.entries);

    while (page.has_more) {
      const continueToken = await this.getAccessToken();
      const continueRes = await fetchWithRetry(`${RPC_API}/list_folder/continue`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${continueToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ cursor: page.cursor }),
      });

      if (!continueRes.ok) {
        throw new Error(`Dropbox list_folder/continue failed (HTTP ${continueRes.status})`);
      }

      page = (await continueRes.json()) as {
        entries: Array<{ '.tag': string; name: string }>;
        has_more: boolean;
        cursor: string;
      };
      entries.push(...page.entries);
    }

    return entries
      .filter((e) => e['.tag'] === 'file' && e.name.endsWith('.bin'))
      .map((e) => e.name.slice(0, -4)); // strip ".bin"
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Download a file from Dropbox. Returns null if the file does not exist.
   */
  private async download(path: string): Promise<Uint8Array | null> {
    const token = await this.getAccessToken();
    const res = await fetchWithRetry(`${CONTENT_API}/download`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Dropbox-API-Arg': JSON.stringify({ path }),
      },
    });

    this.checkAuth(res);
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as {
        error_summary?: string;
        error?: { '.tag'?: string };
      };
      if (this.isNotFound(res.status, body)) {
        return null;
      }
      throw new Error(`Dropbox download failed (HTTP ${res.status})`);
    }

    return new Uint8Array(await res.arrayBuffer());
  }

  /**
   * Upload a file to Dropbox with overwrite mode.
   */
  private async upload(path: string, data: Uint8Array): Promise<void> {
    const token = await this.getAccessToken();
    const res = await fetchWithRetry(`${CONTENT_API}/upload`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
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
      throw new Error(`Dropbox upload failed (HTTP ${res.status})`);
    }
  }

  /** Throw SyncAuthError on 401. */
  private checkAuth(res: { status: number }): void {
    if (res.status === 401) {
      throw new SyncAuthError(`Dropbox auth failed (HTTP ${res.status})`);
    }
  }

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
