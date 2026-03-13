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

import type { ISyncAdapter, SyncManifest } from './types.js';
import { SyncAuthError } from './errors.js';

const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';

/** Options for constructing a GoogleDriveAdapter. */
export interface GoogleDriveAdapterOptions {
  /** Called before every request to obtain a fresh OAuth2 access token. */
  getAccessToken: () => Promise<string>;
}

/**
 * Sanitize a file-name string for embedding inside a Drive API query string.
 *
 * Drive's query language requires `\` → `\\` and `'` → `\'`.
 */
function sanitizeQueryName(name: string): string {
  return name.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/**
 * Sync adapter backed by Google Drive's `appDataFolder` scope.
 *
 * File layout:
 * - `manifest.json`  — the SyncManifest (JSON text)
 * - `<id>.bin`       — encrypted vault items (raw bytes)
 */
export class GoogleDriveAdapter implements ISyncAdapter {
  private readonly getAccessToken: () => Promise<string>;
  /** Cache: logical file name → Drive file id. */
  private readonly fileIdCache = new Map<string, string>();

  constructor(options: GoogleDriveAdapterOptions) {
    this.getAccessToken = options.getAccessToken;
  }

  // ---------------------------------------------------------------------------
  // ISyncAdapter implementation
  // ---------------------------------------------------------------------------

  async readManifest(): Promise<SyncManifest | null> {
    const fileId = await this.findFile('manifest.json');
    if (!fileId) return null;

    const token = await this.getAccessToken();
    const res = await fetch(`${DRIVE_API}/files/${fileId}?alt=media`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    this.checkAuth(res);

    const buf = await res.arrayBuffer();
    const text = new TextDecoder().decode(buf);
    return JSON.parse(text) as SyncManifest;
  }

  async writeManifest(manifest: SyncManifest): Promise<void> {
    const data = new TextEncoder().encode(JSON.stringify(manifest));
    await this.upsertFile('manifest.json', data, 'application/json');
  }

  async readItem(id: string): Promise<Uint8Array | null> {
    const name = `${id}.bin`;
    const fileId = await this.findFile(name);
    if (!fileId) return null;

    const token = await this.getAccessToken();
    const res = await fetch(`${DRIVE_API}/files/${fileId}?alt=media`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    this.checkAuth(res);

    const buf = await res.arrayBuffer();
    return new Uint8Array(buf);
  }

  async writeItem(id: string, data: Uint8Array): Promise<void> {
    await this.upsertFile(`${id}.bin`, data, 'application/octet-stream');
  }

  async deleteItem(id: string): Promise<void> {
    const name = `${id}.bin`;
    const fileId = await this.findFile(name);
    if (!fileId) return; // already gone — nothing to do

    const token = await this.getAccessToken();
    const res = await fetch(`${DRIVE_API}/files/${fileId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    this.checkAuth(res);

    // Clear from cache so subsequent reads hit the API
    this.fileIdCache.delete(name);
  }

  async listItems(): Promise<string[]> {
    const token = await this.getAccessToken();
    const query = encodeURIComponent("mimeType='application/octet-stream' and trashed=false");
    const res = await fetch(
      `${DRIVE_API}/files?spaces=appDataFolder&fields=files(id,name)&q=${query}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    this.checkAuth(res);

    const body = (await res.json()) as { files?: Array<{ id: string; name: string }> };
    const files = body.files ?? [];

    return files
      .filter((f) => f.name.endsWith('.bin'))
      .map((f) => f.name.slice(0, -4)); // strip ".bin"
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

    const token = await this.getAccessToken();
    const safe = sanitizeQueryName(name);
    const query = encodeURIComponent(`name='${safe}' and trashed=false`);
    const res = await fetch(
      `${DRIVE_API}/files?spaces=appDataFolder&fields=files(id)&q=${query}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    this.checkAuth(res);

    const body = (await res.json()) as { files?: Array<{ id: string }> };
    const fileId = body.files?.[0]?.id ?? null;

    if (fileId) {
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
    const token = await this.getAccessToken();

    if (existingId) {
      // PATCH — update content only (metadata already set)
      const res = await fetch(
        `${DRIVE_UPLOAD_API}/files/${existingId}?uploadType=media`,
        {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': mimeType,
          },
          body: data,
        },
      );
      this.checkAuth(res);
    } else {
      // POST multipart — create with metadata + content in one request
      const boundary = crypto.randomUUID();
      const encoder = new TextEncoder();

      const metadataPart = encoder.encode(
        `--${boundary}\r\n` +
          'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
          JSON.stringify({ name, parents: ['appDataFolder'] }) +
          '\r\n',
      );
      const dataPart = encoder.encode(
        `--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`,
      );
      const closing = encoder.encode(`\r\n--${boundary}--`);

      // Concatenate all parts with the binary data
      const body = new Uint8Array(
        metadataPart.length + dataPart.length + data.length + closing.length,
      );
      body.set(metadataPart, 0);
      body.set(dataPart, metadataPart.length);
      body.set(data, metadataPart.length + dataPart.length);
      body.set(closing, metadataPart.length + dataPart.length + data.length);

      const res = await fetch(
        `${DRIVE_UPLOAD_API}/files?uploadType=multipart`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': `multipart/related; boundary=${boundary}`,
          },
          body,
        },
      );
      this.checkAuth(res);

      const created = (await res.json()) as { id?: string };
      if (created.id) {
        this.fileIdCache.set(name, created.id);
      }
    }
  }

  /**
   * Throw a SyncAuthError if the response indicates an auth failure.
   */
  private checkAuth(res: { ok: boolean; status: number }): void {
    if (res.status === 401 || res.status === 403) {
      throw new SyncAuthError(
        `Google Drive auth failed (HTTP ${res.status})`,
      );
    }
  }
}
