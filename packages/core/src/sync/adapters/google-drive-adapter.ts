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
