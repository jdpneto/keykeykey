import { describe, it, expect, beforeEach, vi } from 'vitest';
// WebDAV sync adapter — implementation: webdav-adapter.ts
import { WebDavAdapter } from './webdav-adapter.js';
import type { SyncManifest } from './types.js';

// Helper to build a minimal Response-like object
function makeResponse(status: number, body?: string | ArrayBuffer | null): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: () => Promise.resolve(body ? JSON.parse(body as string) : null),
    arrayBuffer: () => Promise.resolve(body instanceof ArrayBuffer ? body : new ArrayBuffer(0)),
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

      await adapter.readManifest();

      const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      const headers = init.headers as Record<string, string>;
      const expected = 'Basic ' + btoa(`${USERNAME}:${PASSWORD}`);
      expect(headers['Authorization']).toBe(expected);
    });
  });

  // -------------------------------------------------------------------------
  // readManifest
  // -------------------------------------------------------------------------
  describe('readManifest()', () => {
    it('should return null on 404', async () => {
      mockFetch.mockResolvedValue(makeResponse(404));

      const result = await adapter.readManifest();
      expect(result).toBeNull();
    });

    it('should parse and return JSON on 200', async () => {
      const manifest: SyncManifest = {
        version: 1,
        lastModified: '2024-01-01T00:00:00.000Z',
        items: { abc: { updatedAt: '2024-01-01T00:00:00.000Z', hash: 'deadbeef' } },
      };
      mockFetch.mockResolvedValue(makeResponse(200, JSON.stringify(manifest)));

      const result = await adapter.readManifest();
      expect(result).toEqual(manifest);
    });

    it('should GET manifest.json from the correct URL', async () => {
      mockFetch.mockResolvedValue(makeResponse(404));

      await adapter.readManifest();

      const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`${BASE_URL}/manifest.json`);
      expect(init.method).toBe('GET');
    });

    it('should throw SyncAuthError on 401', async () => {
      mockFetch.mockResolvedValue(makeResponse(401));
      await expect(adapter.readManifest()).rejects.toThrow('Sync authentication failed');
    });

    it('should throw SyncAuthError on 403', async () => {
      mockFetch.mockResolvedValue(makeResponse(403));
      await expect(adapter.readManifest()).rejects.toThrow('Sync authentication failed');
    });
  });

  // -------------------------------------------------------------------------
  // writeManifest
  // -------------------------------------------------------------------------
  describe('writeManifest()', () => {
    const manifest: SyncManifest = {
      version: 1,
      lastModified: '2024-01-01T00:00:00.000Z',
      items: {},
    };

    beforeEach(() => {
      // MKCOL for ensureDir + PUT for the manifest itself
      mockFetch
        .mockResolvedValueOnce(makeResponse(201)) // MKCOL
        .mockResolvedValueOnce(makeResponse(204)); // PUT
    });

    it('should PUT JSON to the correct URL', async () => {
      await adapter.writeManifest(manifest);

      const putCall = mockFetch.mock.calls.find(
        ([, init]: [string, RequestInit]) => (init as RequestInit).method === 'PUT',
      ) as [string, RequestInit] | undefined;

      expect(putCall).toBeDefined();
      const [url] = putCall!;
      expect(url).toBe(`${BASE_URL}/manifest.json`);
    });

    it('should send the manifest as JSON string in the body', async () => {
      await adapter.writeManifest(manifest);

      const putCall = mockFetch.mock.calls.find(
        ([, init]: [string, RequestInit]) => (init as RequestInit).method === 'PUT',
      ) as [string, RequestInit] | undefined;

      expect(putCall).toBeDefined();
      const [, init] = putCall!;
      expect(init.body).toBe(JSON.stringify(manifest));
    });

    it('should call MKCOL to ensure the directory exists', async () => {
      await adapter.writeManifest(manifest);

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

      await expect(adapter.writeManifest(manifest)).resolves.not.toThrow();
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
        .mockResolvedValueOnce(makeResponse(201)) // MKCOL
        .mockResolvedValueOnce(makeResponse(204)); // PUT

      await adapter.writeItem('item-abc', new Uint8Array([1]));

      const mkcolCall = mockFetch.mock.calls.find(
        ([, init]: [string, RequestInit]) => (init as RequestInit).method === 'MKCOL',
      );
      expect(mkcolCall).toBeDefined();
      const [url] = mkcolCall as [string, RequestInit];
      expect(url).toBe(`${BASE_URL}/items`);
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
      mockFetch.mockRejectedValue(new Error('Network error'));
      const result = await adapter.ping();
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

      await adapterWithSlash.readManifest();

      const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`${BASE_URL}/manifest.json`);
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
      await plain.readManifest();
      const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://dav.example.com/remote/keykeykey/manifest.json');
    });

    it('should not double-append /keykeykey', async () => {
      const already = new WebDavAdapter({
        url: 'https://dav.example.com/remote/keykeykey',
        username: USERNAME,
        password: PASSWORD,
      });
      mockFetch.mockResolvedValue(makeResponse(404));
      await already.readManifest();
      const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://dav.example.com/remote/keykeykey/manifest.json');
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
});
