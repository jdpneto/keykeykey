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

import { TemplateHttpAdapter } from './base-http-adapter.js';

const CONTENT_API = 'https://content.dropboxapi.com/2/files';
const RPC_API = 'https://api.dropboxapi.com/2/files';

/** Options for constructing a DropboxAdapter. */
export interface DropboxAdapterOptions {
  /** Called before every request to obtain a fresh OAuth2 access token. */
  getAccessToken: () => Promise<string>;
}

export class DropboxAdapter extends TemplateHttpAdapter {
  protected override readonly providerName = 'Dropbox';

  constructor(options: DropboxAdapterOptions) {
    super({
      getAccessToken: options.getAccessToken,
      vaultBlobName: '/vault.enc',
      legacyManifestName: '/manifest.json',
    });
  }

  // ---------------------------------------------------------------------------
  // Error-shape overrides
  // ---------------------------------------------------------------------------

  /** Dropbox uses 403 for non-auth errors (e.g. permission shape mismatches). */
  protected override isAuthFailure(res: { status: number }): boolean {
    return res.status === 401;
  }

  /**
   * Dropbox returns HTTP 409 with varying error structures per endpoint. The
   * `error_summary` string (e.g. `"path/not_found/..."`) is the most reliable
   * field across all endpoints.
   */
  protected override isNotFound(res: { status: number }, body: Record<string, unknown>): boolean {
    if (res.status !== 409) return false;
    const summary = body.error_summary;
    if (typeof summary === 'string' && summary.includes('not_found')) return true;
    const tag = (body.error as { '.tag'?: string } | undefined)?.['.tag'] ?? '';
    return tag === 'path/not_found' || tag.startsWith('path/not_found');
  }

  // ---------------------------------------------------------------------------
  // Primitives required by TemplateHttpAdapter
  // ---------------------------------------------------------------------------

  protected async downloadBlob(path: string): Promise<Uint8Array | null> {
    const headers = await this.buildAuthHeaders();
    const res = await this.fetchRetry(CONTENT_API + '/download', {
      method: 'POST',
      headers: { ...headers, 'Dropbox-API-Arg': JSON.stringify({ path }) },
    });

    if (await this.handleNotFound(res, 'download')) return null;
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
    this.throwIfError(res, 'upload');
  }

  protected async deleteBlob(path: string): Promise<void> {
    const headers = await this.buildAuthHeaders();
    const res = await this.fetchRetry(RPC_API + '/delete_v2', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ path }),
    });

    // not-found is OK for delete (already gone); other errors throw
    await this.handleNotFound(res, 'delete');
  }

  protected async listBlobsRaw(): Promise<string[]> {
    const headers = await this.buildAuthHeaders();
    const res = await this.fetchRetry(RPC_API + '/list_folder', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: '/items' }),
    });

    if (await this.handleNotFound(res, 'list_folder')) return [];

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
      this.checkAuth(continueRes);
      this.throwIfError(continueRes, 'list_folder/continue');
      page = (await continueRes.json()) as {
        entries: Array<{ '.tag': string; name: string }>;
        has_more: boolean;
        cursor: string;
      };
      entries.push(...page.entries);
    }

    // Only keep files (not folders) — TemplateHttpAdapter will filter by extension
    return entries.filter((e) => e['.tag'] === 'file').map((e) => e.name);
  }

  /** Items live at `/items/{id}.bin`. */
  protected override itemPath(id: string): string {
    return '/items/' + id + this.itemExtension;
  }
}
