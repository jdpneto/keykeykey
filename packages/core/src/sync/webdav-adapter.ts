/**
 * WebDAV sync adapter.
 *
 * Stores the vault manifest and encrypted items on any WebDAV server
 * (Nextcloud, ownCloud, Apache mod_dav, etc.).
 *
 * Server layout:
 *   {baseUrl}/manifest.json       — sync manifest
 *   {baseUrl}/items/{id}.bin      — encrypted vault items
 */

import { SyncAuthError } from './errors.js';
import type { ISyncAdapter, SyncManifest } from './types.js';

/** Base64-encode a string. Works in browsers (btoa), Node, and React Native. */
function encodeBase64(str: string): string {
  if (typeof globalThis.btoa === 'function') return globalThis.btoa(str);
  // Node.js fallback — access Buffer via globalThis to avoid TS DOM-only compilation
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const B = (globalThis as any).Buffer;
  if (B) return B.from(str, 'utf-8').toString('base64');
  throw new Error('No base64 encoder available');
}

export interface WebDavAdapterOptions {
  /** Base URL of the WebDAV collection. */
  url: string;
  /** WebDAV username. */
  username: string;
  /** WebDAV password. */
  password: string;
}

export class WebDavAdapter implements ISyncAdapter {
  private readonly baseUrl: string;
  private readonly authHeader: string;

  constructor({ url, username, password }: WebDavAdapterOptions) {
    const trimmed = url.replace(/\/+$/, '');
    if (!trimmed.startsWith('https://') && !trimmed.startsWith('http://localhost')) {
      throw new Error(
        'WebDAV sync requires HTTPS for security. Use https:// or http://localhost for local development.',
      );
    }
    this.baseUrl = trimmed;
    this.authHeader = 'Basic ' + encodeBase64(`${username}:${password}`);
  }

  async readManifest(): Promise<SyncManifest | null> {
    const res = await this.httpGet(`${this.baseUrl}/manifest.json`);
    if (res.status === 404) return null;
    this.checkAuth(res);
    return res.json() as Promise<SyncManifest>;
  }

  async writeManifest(manifest: SyncManifest): Promise<void> {
    await this.ensureDir(this.baseUrl);
    const res = await this.httpPut(`${this.baseUrl}/manifest.json`, JSON.stringify(manifest), {
      'Content-Type': 'application/json',
    });
    this.checkAuth(res);
  }

  async readItem(id: string): Promise<Uint8Array | null> {
    const res = await this.httpGet(`${this.baseUrl}/items/${id}.bin`);
    if (res.status === 404) return null;
    this.checkAuth(res);
    return new Uint8Array(await res.arrayBuffer());
  }

  async writeItem(id: string, data: Uint8Array): Promise<void> {
    await this.ensureDir(`${this.baseUrl}/items`);
    const res = await this.httpPut(`${this.baseUrl}/items/${id}.bin`, data, {
      'Content-Type': 'application/octet-stream',
    });
    this.checkAuth(res);
  }

  async deleteItem(id: string): Promise<void> {
    const res = await this.httpDelete(`${this.baseUrl}/items/${id}.bin`);
    if (res.status === 404) return;
    this.checkAuth(res);
  }

  async listItems(): Promise<string[]> {
    const res = await this.httpPropfind(`${this.baseUrl}/items`, '1');
    if (res.status === 404) return [];
    this.checkAuth(res);
    const xml = await res.text();
    return this.parseItemIds(xml);
  }

  /** PROPFIND Depth:0 connectivity check. Returns true on success, false on any error. */
  async ping(): Promise<boolean> {
    try {
      const res = await this.httpPropfind(this.baseUrl, '0');
      return res.status >= 200 && res.status < 400;
    } catch {
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async ensureDir(url: string): Promise<void> {
    const res = await fetch(url, {
      method: 'MKCOL',
      headers: { Authorization: this.authHeader },
    });
    if (res.status === 405) return; // collection already exists
    this.checkAuth(res);
  }

  private checkAuth(res: Response): void {
    if (res.status === 401 || res.status === 403) {
      throw new SyncAuthError();
    }
  }

  private httpGet(url: string): Promise<Response> {
    return fetch(url, {
      method: 'GET',
      headers: { Authorization: this.authHeader },
    });
  }

  private httpPut(
    url: string,
    body: string | Uint8Array,
    extraHeaders: Record<string, string> = {},
  ): Promise<Response> {
    return fetch(url, {
      method: 'PUT',
      headers: { Authorization: this.authHeader, ...extraHeaders },
      body: body as BodyInit,
    });
  }

  private httpDelete(url: string): Promise<Response> {
    return fetch(url, {
      method: 'DELETE',
      headers: { Authorization: this.authHeader },
    });
  }

  private httpPropfind(url: string, depth: '0' | '1'): Promise<Response> {
    return fetch(url, {
      method: 'PROPFIND',
      headers: { Authorization: this.authHeader, Depth: depth },
    });
  }

  /**
   * Parse item IDs from a PROPFIND XML response.
   * Matches href values ending in /<id>.bin and strips the extension.
   * Skips the collection href (ends with /).
   */
  private parseItemIds(xml: string): string[] {
    const ids: string[] = [];
    const re = /<[^:>]*:?href[^>]*>([^<]+)<\/[^:>]*:?href>/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(xml)) !== null) {
      const href = m[1]?.trim();
      if (!href || href.endsWith('/')) continue;
      const tail = /\/([^/]+)\.bin$/.exec(href);
      if (tail?.[1]) ids.push(tail[1]);
    }
    return ids;
  }
}
