import { describe, it, expect, beforeEach, vi } from 'vitest';
// WebDAV sync adapter — implementation: webdav-adapter.ts
import { WebDavAdapter } from './webdav-adapter.js';
import type { SyncManifest } from '../core/types.js';

// Helper to build a minimal Response-like object
function makeResponse(status: number, body?: string | ArrayBuffer | Uint8Array | null): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: () => Promise.resolve(body ? JSON.parse(body as string) : null),
    arrayBuffer: () => {
      if (body instanceof ArrayBuffer) return Promise.resolve(body);
      if (body instanceof Uint8Array) return Promise.resolve(body.buffer);
      return Promise.resolve(new ArrayBuffer(0));
    },
    text: () => Promise.resolve(typeof body === 'string' ? body : ''),
  } as unknown as Response;
}

describe('WebDavAdapter', () => {
  const BASE_URL = 'https://dav.example.com/remote.php/dav/files/user/vault/keykeykey';
  const USERNAME = 'alice';
  const PASSWORD = 's3cr3t';

  let adapter: WebDavAdapter;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
    adapter = new WebDavAdapter({ url: BASE_URL, username: USERNAME, password: PASSWORD });
  });

  // -------------------------------------------------------------------------
  // Auth header
  // -------------------------------------------------------------------------
  describe('Basic auth header', () => {
    it('should send the correct Authorization header on every request', async () => {
      mockFetch.mockResolvedValue(makeResponse(404));

      await adapter.readVaultBlob();

      const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      const headers = init.headers as Record<string, string>;
      const expected = 'Basic ' + btoa(`${USERNAME}:${PASSWORD}`);
      expect(headers['Authorization']).toBe(expected);
    });
  });

  // -------------------------------------------------------------------------
  // readVaultBlob
  // -------------------------------------------------------------------------
  describe('readVaultBlob()', () => {
    it('should return null on 404', async () => {
      mockFetch.mockResolvedValue(makeResponse(404));

      const result = await adapter.readVaultBlob();
      expect(result).toBeNull();
    });

    it('should return Uint8Array on 200', async () => {
      const bytes = new Uint8Array([10, 20, 30]);
      mockFetch.mockResolvedValue(makeResponse(200, bytes));

      const result = await adapter.readVaultBlob();
      expect(result).toBeInstanceOf(Uint8Array);
      expect(result).toEqual(bytes);
    });

    it('should GET vault.enc from the correct URL', async () => {
      mockFetch.mockResolvedValue(makeResponse(404));

      await adapter.readVaultBlob();

      const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`${BASE_URL}/vault.enc`);
      expect(init.method).toBe('GET');
    });

    it('should throw SyncAuthError on 401', async () => {
      mockFetch.mockResolvedValue(makeResponse(401));
      await expect(adapter.readVaultBlob()).rejects.toThrow('Sync authentication failed');
    });

    it('should throw SyncAuthError on 403', async () => {
      mockFetch.mockResolvedValue(makeResponse(403));
      await expect(adapter.readVaultBlob()).rejects.toThrow('Sync authentication failed');
    });
  });

  // -------------------------------------------------------------------------
  // writeVaultBlob
  // -------------------------------------------------------------------------
  describe('writeVaultBlob()', () => {
    const blob = new Uint8Array([1, 2, 3, 4]);

    beforeEach(() => {
      // MKCOL for ensureDir + PUT for the blob itself
      mockFetch
        .mockResolvedValueOnce(makeResponse(201)) // MKCOL
        .mockResolvedValueOnce(makeResponse(204)); // PUT
    });

    it('should PUT binary to the correct URL', async () => {
      await adapter.writeVaultBlob(blob);

      const putCall = mockFetch.mock.calls.find(
        ([, init]: [string, RequestInit]) => (init as RequestInit).method === 'PUT',
      ) as [string, RequestInit] | undefined;

      expect(putCall).toBeDefined();
      const [url, init] = putCall!;
      expect(url).toBe(`${BASE_URL}/vault.enc`);
      expect(init.body).toBeInstanceOf(Uint8Array);
      expect(init.body).toEqual(blob);
    });

    it('should send Content-Type application/octet-stream', async () => {
      await adapter.writeVaultBlob(blob);

      const putCall = mockFetch.mock.calls.find(
        ([, init]: [string, RequestInit]) => (init as RequestInit).method === 'PUT',
      ) as [string, RequestInit] | undefined;

      expect(putCall).toBeDefined();
      const [, init] = putCall!;
      const headers = init.headers as Record<string, string>;
      expect(headers['Content-Type']).toBe('application/octet-stream');
    });

    it('should call MKCOL to ensure the directory exists', async () => {
      await adapter.writeVaultBlob(blob);

      const mkcolCall = mockFetch.mock.calls.find(
        ([, init]: [string, RequestInit]) => (init as RequestInit).method === 'MKCOL',
      );
      expect(mkcolCall).toBeDefined();
    });

    it('should ignore 405 from MKCOL (directory already exists)', async () => {
      mockFetch
        .mockReset()
        .mockResolvedValueOnce(makeResponse(405)) // MKCOL — already exists
        .mockResolvedValueOnce(makeResponse(204)); // PUT

      await expect(adapter.writeVaultBlob(blob)).resolves.not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // readLegacyManifest
  // -------------------------------------------------------------------------
  describe('readLegacyManifest()', () => {
    it('should return null on 404', async () => {
      mockFetch.mockResolvedValue(makeResponse(404));

      const result = await adapter.readLegacyManifest();
      expect(result).toBeNull();
    });

    it('should parse and return JSON on 200', async () => {
      const manifest: SyncManifest = {
        version: 1,
        lastModified: '2024-01-01T00:00:00.000Z',
        items: { abc: { updatedAt: '2024-01-01T00:00:00.000Z', hash: 'deadbeef' } },
      };
      mockFetch.mockResolvedValue(makeResponse(200, JSON.stringify(manifest)));

      const result = await adapter.readLegacyManifest();
      expect(result).toEqual(manifest);
    });

    it('should GET manifest.json from the correct URL', async () => {
      mockFetch.mockResolvedValue(makeResponse(404));

      await adapter.readLegacyManifest();

      const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`${BASE_URL}/manifest.json`);
      expect(init.method).toBe('GET');
    });

    it('should throw SyncAuthError on 401', async () => {
      mockFetch.mockResolvedValue(makeResponse(401));
      await expect(adapter.readLegacyManifest()).rejects.toThrow('Sync authentication failed');
    });
  });

  // -------------------------------------------------------------------------
  // deleteLegacyManifest
  // -------------------------------------------------------------------------
  describe('deleteLegacyManifest()', () => {
    it('should send DELETE to the correct URL', async () => {
      mockFetch.mockResolvedValue(makeResponse(204));

      await adapter.deleteLegacyManifest();

      const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`${BASE_URL}/manifest.json`);
      expect(init.method).toBe('DELETE');
    });

    it('should not throw on 404 (already gone)', async () => {
      mockFetch.mockResolvedValue(makeResponse(404));
      await expect(adapter.deleteLegacyManifest()).resolves.not.toThrow();
    });

    it('should throw SyncAuthError on 401', async () => {
      mockFetch.mockResolvedValue(makeResponse(401));
      await expect(adapter.deleteLegacyManifest()).rejects.toThrow('Sync authentication failed');
    });
  });

  // -------------------------------------------------------------------------
  // readItem
  // -------------------------------------------------------------------------
  describe('readItem()', () => {
    it('should return null on 404', async () => {
      mockFetch.mockResolvedValue(makeResponse(404));

      const result = await adapter.readItem('item-abc');
      expect(result).toBeNull();
    });

    it('should return a Uint8Array on 200', async () => {
      const bytes = new Uint8Array([10, 20, 30]);
      mockFetch.mockResolvedValue({
        status: 200,
        ok: true,
        arrayBuffer: () => Promise.resolve(bytes.buffer),
      } as unknown as Response);

      const result = await adapter.readItem('item-abc');
      expect(result).toBeInstanceOf(Uint8Array);
      expect(result).toEqual(bytes);
    });

    it('should GET from the correct items/ path', async () => {
      mockFetch.mockResolvedValue(makeResponse(404));

      await adapter.readItem('item-xyz');

      const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`${BASE_URL}/items/item-xyz.bin`);
      expect(init.method).toBe('GET');
    });

    it('should throw SyncAuthError on 401', async () => {
      mockFetch.mockResolvedValue(makeResponse(401));
      await expect(adapter.readItem('item-1')).rejects.toThrow('Sync authentication failed');
    });
  });

  // -------------------------------------------------------------------------
  // writeItem
  // -------------------------------------------------------------------------
  describe('writeItem()', () => {
    it('should PUT binary data to the correct items/ URL', async () => {
      mockFetch
        .mockResolvedValueOnce(makeResponse(201)) // MKCOL for base dir
        .mockResolvedValueOnce(makeResponse(201)) // MKCOL for items dir
        .mockResolvedValueOnce(makeResponse(204)); // PUT

      const data = new Uint8Array([5, 6, 7]);
      await adapter.writeItem('item-abc', data);

      const putCall = mockFetch.mock.calls.find(
        ([, init]: [string, RequestInit]) => (init as RequestInit).method === 'PUT',
      ) as [string, RequestInit] | undefined;

      expect(putCall).toBeDefined();
      const [url, init] = putCall!;
      expect(url).toBe(`${BASE_URL}/items/item-abc.bin`);
      expect(init.body).toBeInstanceOf(Uint8Array);
      expect(init.body).toEqual(data);
    });

    it('should call MKCOL to ensure items directory exists', async () => {
      mockFetch
        .mockResolvedValueOnce(makeResponse(201)) // MKCOL base
        .mockResolvedValueOnce(makeResponse(201)) // MKCOL items
        .mockResolvedValueOnce(makeResponse(204)); // PUT

      await adapter.writeItem('item-abc', new Uint8Array([1]));

      const mkcolCalls = mockFetch.mock.calls.filter(
        ([, init]: [string, RequestInit]) => (init as RequestInit).method === 'MKCOL',
      );
      expect(mkcolCalls).toHaveLength(2);
      const [baseUrl] = mkcolCalls[0] as [string, RequestInit];
      expect(baseUrl).toBe(`${BASE_URL}/`);
      const [itemsUrl] = mkcolCalls[1] as [string, RequestInit];
      expect(itemsUrl).toBe(`${BASE_URL}/items/`);
    });
  });

  // -------------------------------------------------------------------------
  // deleteItem
  // -------------------------------------------------------------------------
  describe('deleteItem()', () => {
    it('should send DELETE to the correct URL', async () => {
      mockFetch.mockResolvedValue(makeResponse(204));

      await adapter.deleteItem('item-abc');

      const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`${BASE_URL}/items/item-abc.bin`);
      expect(init.method).toBe('DELETE');
    });

    it('should not throw on 404 (item already gone)', async () => {
      mockFetch.mockResolvedValue(makeResponse(404));
      await expect(adapter.deleteItem('nonexistent')).resolves.not.toThrow();
    });

    it('should throw SyncAuthError on 401', async () => {
      mockFetch.mockResolvedValue(makeResponse(401));
      await expect(adapter.deleteItem('item-1')).rejects.toThrow('Sync authentication failed');
    });
  });

  // -------------------------------------------------------------------------
  // listItems
  // -------------------------------------------------------------------------
  describe('listItems()', () => {
    it('should return item IDs parsed from PROPFIND XML response', async () => {
      const xml = `<?xml version="1.0"?>
<D:multistatus xmlns:D="DAV:">
  <D:response><D:href>/remote.php/dav/files/user/vault/items/</D:href></D:response>
  <D:response><D:href>/remote.php/dav/files/user/vault/items/abc123.bin</D:href></D:response>
  <D:response><D:href>/remote.php/dav/files/user/vault/items/def456.bin</D:href></D:response>
</D:multistatus>`;

      mockFetch.mockResolvedValue({
        status: 207,
        ok: true,
        text: () => Promise.resolve(xml),
      } as unknown as Response);

      const items = await adapter.listItems();
      expect(items.sort()).toEqual(['abc123', 'def456']);
    });

    it('should return empty array when no items', async () => {
      const xml = `<?xml version="1.0"?>
<D:multistatus xmlns:D="DAV:">
  <D:response><D:href>/remote.php/dav/files/user/vault/items/</D:href></D:response>
</D:multistatus>`;

      mockFetch.mockResolvedValue({
        status: 207,
        ok: true,
        text: () => Promise.resolve(xml),
      } as unknown as Response);

      const items = await adapter.listItems();
      expect(items).toEqual([]);
    });

    it('should send PROPFIND with Depth:1 to items/ path', async () => {
      const xml = `<D:multistatus xmlns:D="DAV:"></D:multistatus>`;
      mockFetch.mockResolvedValue({
        status: 207,
        ok: true,
        text: () => Promise.resolve(xml),
      } as unknown as Response);

      await adapter.listItems();

      const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`${BASE_URL}/items`);
      expect(init.method).toBe('PROPFIND');
      const headers = init.headers as Record<string, string>;
      expect(headers['Depth']).toBe('1');
    });

    it('should return empty array when items directory does not exist (404)', async () => {
      mockFetch.mockResolvedValue(makeResponse(404));
      const items = await adapter.listItems();
      expect(items).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // ping
  // -------------------------------------------------------------------------
  describe('ping()', () => {
    it('should return true on 207 response', async () => {
      mockFetch.mockResolvedValue(makeResponse(207));
      const result = await adapter.ping();
      expect(result).toBe(true);
    });

    it('should return true on 200 response', async () => {
      mockFetch.mockResolvedValue(makeResponse(200));
      const result = await adapter.ping();
      expect(result).toBe(true);
    });

    it('should return false on network error', async () => {
      vi.useFakeTimers();
      mockFetch.mockRejectedValue(new Error('Network error'));
      const resultPromise = adapter.ping();
      // fetchRetry retries on network errors with exponential backoff; advance
      // time past all retry delays so the promise resolves quickly.
      await vi.runAllTimersAsync();
      const result = await resultPromise;
      vi.useRealTimers();
      expect(result).toBe(false);
    });

    it('should return false on 401 (auth failure during ping)', async () => {
      mockFetch.mockResolvedValue(makeResponse(401));
      const result = await adapter.ping();
      expect(result).toBe(false);
    });

    it('should send PROPFIND with Depth:0 to base URL', async () => {
      mockFetch.mockResolvedValue(makeResponse(207));
      await adapter.ping();

      const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(BASE_URL);
      expect(init.method).toBe('PROPFIND');
      const headers = init.headers as Record<string, string>;
      expect(headers['Depth']).toBe('0');
    });
  });

  // -------------------------------------------------------------------------
  // Trailing slash normalization
  // -------------------------------------------------------------------------
  describe('trailing slash normalization', () => {
    it('should strip a trailing slash from the base URL', async () => {
      const adapterWithSlash = new WebDavAdapter({
        url: BASE_URL + '/',
        username: USERNAME,
        password: PASSWORD,
      });
      mockFetch.mockResolvedValue(makeResponse(404));

      await adapterWithSlash.readVaultBlob();

      const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`${BASE_URL}/vault.enc`);
    });
  });

  // -------------------------------------------------------------------------
  // /keykeykey subdirectory enforcement
  // -------------------------------------------------------------------------
  describe('/keykeykey subdirectory', () => {
    it('should auto-append /keykeykey when URL does not end with it', async () => {
      const plain = new WebDavAdapter({
        url: 'https://dav.example.com/remote',
        username: USERNAME,
        password: PASSWORD,
      });
      mockFetch.mockResolvedValue(makeResponse(404));
      await plain.readVaultBlob();
      const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://dav.example.com/remote/keykeykey/vault.enc');
    });

    it('should not double-append /keykeykey', async () => {
      const already = new WebDavAdapter({
        url: 'https://dav.example.com/remote/keykeykey',
        username: USERNAME,
        password: PASSWORD,
      });
      mockFetch.mockResolvedValue(makeResponse(404));
      await already.readVaultBlob();
      const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://dav.example.com/remote/keykeykey/vault.enc');
    });
  });

  // -------------------------------------------------------------------------
  // HTTPS enforcement
  // -------------------------------------------------------------------------

  describe('HTTPS enforcement', () => {
    it('should reject http:// URLs', () => {
      expect(
        () => new WebDavAdapter({ url: 'http://example.com/vault', username: 'u', password: 'p' }),
      ).toThrow('WebDAV sync requires HTTPS');
    });

    it('should allow https:// URLs', () => {
      expect(
        () => new WebDavAdapter({ url: 'https://example.com/vault', username: 'u', password: 'p' }),
      ).not.toThrow();
    });

    it('should allow http://localhost for local development', () => {
      expect(
        () =>
          new WebDavAdapter({
            url: 'http://localhost:8080/vault',
            username: 'u',
            password: 'p',
          }),
      ).not.toThrow();
    });

    it('should reject http:// with non-localhost host', () => {
      expect(
        () =>
          new WebDavAdapter({
            url: 'http://192.168.1.100/vault',
            username: 'u',
            password: 'p',
          }),
      ).toThrow('WebDAV sync requires HTTPS');
    });

    it('should reject file:// URLs', () => {
      expect(
        () => new WebDavAdapter({ url: 'file:///etc/passwd', username: 'u', password: 'p' }),
      ).toThrow('WebDAV sync requires HTTPS');
    });

    it('should reject ftp:// URLs', () => {
      expect(
        () => new WebDavAdapter({ url: 'ftp://example.com/vault', username: 'u', password: 'p' }),
      ).toThrow('WebDAV sync requires HTTPS');
    });

    it('should reject URLs without a scheme', () => {
      expect(
        () => new WebDavAdapter({ url: 'example.com/vault', username: 'u', password: 'p' }),
      ).toThrow('WebDAV sync requires HTTPS');
    });
  });

  it('retries failed requests via fetchRetry', async () => {
    let callCount = 0;
    const fetchMock = vi.fn(async () => {
      callCount++;
      if (callCount === 1) {
        // First call: network error that fetchWithRetry treats as retryable
        throw new TypeError('network');
      }
      return new Response(null, { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    vi.useFakeTimers();
    const adapter = new WebDavAdapter({
      url: 'https://example.com/webdav',
      username: 'user',
      password: 'pass',
    });
    const resultPromise = adapter.readVaultBlob();
    // Advance past the retry backoff delay
    await vi.runAllTimersAsync();
    const result = await resultPromise;
    vi.useRealTimers();

    expect(result).toBeNull();
    expect(callCount).toBeGreaterThanOrEqual(2);
    vi.unstubAllGlobals();
  });
});
