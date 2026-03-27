/**
 * OneDrive sync adapter.
 *
 * Stores all vault files in the OneDrive app folder using the Microsoft Graph API v1.0.
 *
 * File layout:
 * - `approot:/vault.enc`        — encrypted vault blob (raw bytes)
 * - `approot:/items/{id}.bin`   — encrypted vault items (raw bytes)
 *
 * Auth is delegated to a `getAccessToken` callback supplied by the caller so
 * this module stays framework-agnostic (works in Expo, Tauri, and the browser
 * extension).
 */

import type { ISyncAdapter } from './types.js';
import { SyncAuthError } from './errors.js';

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0/me/drive/special/approot:';

/** Options for constructing an OneDriveAdapter. */
export interface OneDriveAdapterOptions {
  /** Called before every request to obtain a fresh OAuth2 access token. */
  getAccessToken: () => Promise<string>;
}

/**
 * Sync adapter backed by the OneDrive app folder via Microsoft Graph API v1.0.
 *
 * File layout:
 * - `approot:/vault.enc`        — encrypted vault blob (raw bytes)
 * - `approot:/items/{id}.bin`   — encrypted vault items (raw bytes)
 */
export class OneDriveAdapter implements ISyncAdapter {
  private readonly getAccessToken: () => Promise<string>;

  constructor(options: OneDriveAdapterOptions) {
    this.getAccessToken = options.getAccessToken;
  }

  // ---------------------------------------------------------------------------
  // ISyncAdapter implementation
  // ---------------------------------------------------------------------------

  async readVaultBlob(): Promise<Uint8Array | null> {
    return this.download('vault.enc');
  }

  async writeVaultBlob(data: Uint8Array): Promise<void> {
    await this.upload('vault.enc', data);
  }

  async readItem(id: string): Promise<Uint8Array | null> {
    return this.download(`items/${id}.bin`);
  }

  async writeItem(id: string, data: Uint8Array): Promise<void> {
    await this.upload(`items/${id}.bin`, data);
  }

  async deleteItem(id: string): Promise<void> {
    const token = await this.getAccessToken();
    const res = await fetch(`${GRAPH_BASE}/items/${id}.bin:`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (res.status === 401 || res.status === 403) {
      throw new SyncAuthError(`OneDrive auth failed (HTTP ${res.status})`);
    }
    if (res.status === 404) {
      return; // already gone — nothing to do
    }
    if (!res.ok) {
      throw new Error(`OneDrive delete failed (HTTP ${res.status})`);
    }
  }

  async listItems(): Promise<string[]> {
    const token = await this.getAccessToken();
    const res = await fetch(`${GRAPH_BASE}/items:/children`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (res.status === 401 || res.status === 403) {
      throw new SyncAuthError(`OneDrive auth failed (HTTP ${res.status})`);
    }
    if (res.status === 404) {
      return []; // folder doesn't exist yet
    }
    if (!res.ok) {
      throw new Error(`OneDrive list failed (HTTP ${res.status})`);
    }

    const entries: Array<{ name: string; file?: unknown }> = [];
    let page = (await res.json()) as {
      value: Array<{ name: string; file?: unknown; folder?: unknown }>;
      '@odata.nextLink'?: string;
    };

    entries.push(...page.value);

    while (page['@odata.nextLink']) {
      const nextToken = await this.getAccessToken();
      const nextRes = await fetch(page['@odata.nextLink'], {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${nextToken}`,
        },
      });

      if (!nextRes.ok) {
        throw new Error(`OneDrive list (nextLink) failed (HTTP ${nextRes.status})`);
      }

      page = (await nextRes.json()) as {
        value: Array<{ name: string; file?: unknown; folder?: unknown }>;
        '@odata.nextLink'?: string;
      };
      entries.push(...page.value);
    }

    return entries
      .filter((e) => e.file !== undefined && e.name.endsWith('.bin'))
      .map((e) => e.name.slice(0, -4)); // strip ".bin"
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Download a file from OneDrive. Returns null if the file does not exist (404).
   */
  private async download(path: string): Promise<Uint8Array | null> {
    const token = await this.getAccessToken();
    const res = await fetch(`${GRAPH_BASE}/${path}:/content`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (res.status === 401 || res.status === 403) {
      throw new SyncAuthError(`OneDrive auth failed (HTTP ${res.status})`);
    }
    if (res.status === 404) {
      return null;
    }
    if (!res.ok) {
      throw new Error(`OneDrive download failed (HTTP ${res.status})`);
    }

    return new Uint8Array(await res.arrayBuffer());
  }

  /**
   * Upload a file to OneDrive, creating or replacing it.
   */
  private async upload(path: string, data: Uint8Array): Promise<void> {
    const token = await this.getAccessToken();
    const res = await fetch(`${GRAPH_BASE}/${path}:/content`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/octet-stream',
      },
      body: data as BodyInit,
    });

    if (res.status === 401 || res.status === 403) {
      throw new SyncAuthError(`OneDrive auth failed (HTTP ${res.status})`);
    }
    if (!res.ok) {
      throw new Error(`OneDrive upload failed (HTTP ${res.status})`);
    }
  }
}
