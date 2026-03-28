import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OneDriveAdapter } from './onedrive-adapter.js';
import { SyncAuthError } from './errors.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeJsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    arrayBuffer: () => Promise.reject(new Error('not bytes')),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response;
}

function makeBytesResponse(data: Uint8Array, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    arrayBuffer: () => Promise.resolve(data.buffer as ArrayBuffer),
    json: () => Promise.reject(new Error('not json')),
    text: () => Promise.reject(new Error('not text')),
  } as unknown as Response;
}

function makeErrorResponse(status: number): Response {
  return {
    ok: false,
    status,
    json: () => Promise.resolve({ error: { code: 'itemNotFound', message: 'Item not found' } }),
    arrayBuffer: () => Promise.reject(new Error('not bytes')),
    text: () => Promise.resolve('error'),
  } as unknown as Response;
}

const ACCESS_TOKEN = 'test-onedrive-token';

function makeAdapter() {
  return new OneDriveAdapter({ getAccessToken: () => Promise.resolve(ACCESS_TOKEN) });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('OneDriveAdapter', () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // -------------------------------------------------------------------------
  // Auth
  // -------------------------------------------------------------------------

  describe('auth', () => {
    it('sends Bearer token from getAccessToken() on every request', async () => {
      mockFetch.mockResolvedValue(makeErrorResponse(404));

      const adapter = makeAdapter();
      await adapter.readVaultBlob();

      const [, options] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect((options.headers as Record<string, string>)['Authorization']).toBe(
        `Bearer ${ACCESS_TOKEN}`,
      );
    });

    it('throws SyncAuthError on 401', async () => {
      mockFetch.mockResolvedValue(makeErrorResponse(401));

      const adapter = makeAdapter();
      await expect(adapter.readVaultBlob()).rejects.toThrow(SyncAuthError);
    });

    it('throws SyncAuthError on 403', async () => {
      mockFetch.mockResolvedValue(makeErrorResponse(403));

      const adapter = makeAdapter();
      await expect(adapter.readVaultBlob()).rejects.toThrow(SyncAuthError);
    });
  });

  // -------------------------------------------------------------------------
  // readVaultBlob
  // -------------------------------------------------------------------------

  describe('readVaultBlob()', () => {
    it('returns null on 404', async () => {
      mockFetch.mockResolvedValue(makeErrorResponse(404));

      const adapter = makeAdapter();
      const result = await adapter.readVaultBlob();

      expect(result).toBeNull();
    });

    it('returns Uint8Array when vault.enc exists', async () => {
      const data = new Uint8Array([10, 20, 30]);
      mockFetch.mockResolvedValue(makeBytesResponse(data));

      const adapter = makeAdapter();
      const result = await adapter.readVaultBlob();

      expect(result).toBeInstanceOf(Uint8Array);
      expect(result).toEqual(data);
    });

    it('GETs from Graph API approot with vault.enc path', async () => {
      const data = new Uint8Array([1, 2, 3]);
      mockFetch.mockResolvedValue(makeBytesResponse(data));

      const adapter = makeAdapter();
      await adapter.readVaultBlob();

      const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toContain('graph.microsoft.com');
      expect(url).toContain('vault.enc');
      expect(url).toContain('content');
      expect(opts.method).toBe('GET');
    });

    it('throws on unexpected non-404 error', async () => {
      mockFetch.mockResolvedValue(makeErrorResponse(500));

      const adapter = makeAdapter();
      await expect(adapter.readVaultBlob()).rejects.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // writeVaultBlob
  // -------------------------------------------------------------------------

  describe('writeVaultBlob()', () => {
    it('PUTs to Graph API approot with vault.enc path', async () => {
      const data = new Uint8Array([1, 2, 3]);
      mockFetch.mockResolvedValue(makeJsonResponse({ id: 'file-id' }));

      const adapter = makeAdapter();
      await adapter.writeVaultBlob(data);

      const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toContain('graph.microsoft.com');
      expect(url).toContain('vault.enc');
      expect(url).toContain('content');
      expect(opts.method).toBe('PUT');
    });

    it('sends binary body with application/octet-stream Content-Type', async () => {
      const data = new Uint8Array([4, 5, 6]);
      mockFetch.mockResolvedValue(makeJsonResponse({ id: 'file-id' }));

      const adapter = makeAdapter();
      await adapter.writeVaultBlob(data);

      const [, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect((opts.headers as Record<string, string>)['Content-Type']).toBe(
        'application/octet-stream',
      );
      expect(opts.body).toEqual(data);
    });

    it('throws SyncAuthError on 401', async () => {
      mockFetch.mockResolvedValue(makeErrorResponse(401));

      const adapter = makeAdapter();
      await expect(adapter.writeVaultBlob(new Uint8Array([1]))).rejects.toThrow(SyncAuthError);
    });
  });

  // -------------------------------------------------------------------------
  // readItem
  // -------------------------------------------------------------------------

  describe('readItem()', () => {
    it('returns null on 404', async () => {
      mockFetch.mockResolvedValue(makeErrorResponse(404));

      const adapter = makeAdapter();
      const result = await adapter.readItem('item-abc');

      expect(result).toBeNull();
    });

    it('returns Uint8Array when item exists', async () => {
      const data = new Uint8Array([7, 8, 9]);
      mockFetch.mockResolvedValue(makeBytesResponse(data));

      const adapter = makeAdapter();
      const result = await adapter.readItem('item-abc');

      expect(result).toBeInstanceOf(Uint8Array);
      expect(result).toEqual(data);
    });

    it('uses path items/{id}.bin', async () => {
      const data = new Uint8Array([1]);
      mockFetch.mockResolvedValue(makeBytesResponse(data));

      const adapter = makeAdapter();
      await adapter.readItem('item-xyz');

      const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toContain('items/item-xyz.bin');
      expect(url).toContain('content');
    });

    it('throws SyncAuthError on 401', async () => {
      mockFetch.mockResolvedValue(makeErrorResponse(401));

      const adapter = makeAdapter();
      await expect(adapter.readItem('item-abc')).rejects.toThrow(SyncAuthError);
    });

    it('throws SyncAuthError on 403', async () => {
      mockFetch.mockResolvedValue(makeErrorResponse(403));

      const adapter = makeAdapter();
      await expect(adapter.readItem('item-abc')).rejects.toThrow(SyncAuthError);
    });
  });

  // -------------------------------------------------------------------------
  // writeItem
  // -------------------------------------------------------------------------

  describe('writeItem()', () => {
    it('PUTs to items/{id}.bin path', async () => {
      const data = new Uint8Array([1, 2, 3]);
      mockFetch.mockResolvedValue(makeJsonResponse({ id: 'file-id' }));

      const adapter = makeAdapter();
      await adapter.writeItem('item-abc', data);

      const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toContain('items/item-abc.bin');
      expect(url).toContain('content');
      expect(opts.method).toBe('PUT');
    });

    it('sends binary body with application/octet-stream Content-Type', async () => {
      const data = new Uint8Array([1, 2, 3]);
      mockFetch.mockResolvedValue(makeJsonResponse({ id: 'file-id' }));

      const adapter = makeAdapter();
      await adapter.writeItem('item-abc', data);

      const [, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect((opts.headers as Record<string, string>)['Content-Type']).toBe(
        'application/octet-stream',
      );
      expect(opts.body).toEqual(data);
    });

    it('throws SyncAuthError on 401', async () => {
      mockFetch.mockResolvedValue(makeErrorResponse(401));

      const adapter = makeAdapter();
      await expect(adapter.writeItem('item-abc', new Uint8Array([1]))).rejects.toThrow(
        SyncAuthError,
      );
    });
  });

  // -------------------------------------------------------------------------
  // deleteItem
  // -------------------------------------------------------------------------

  describe('deleteItem()', () => {
    it('DELETEs to Graph API with correct items/{id}.bin path', async () => {
      mockFetch.mockResolvedValue({ ok: true, status: 204 } as unknown as Response);

      const adapter = makeAdapter();
      await adapter.deleteItem('item-abc');

      const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toContain('graph.microsoft.com');
      expect(url).toContain('items/item-abc.bin');
      expect(opts.method).toBe('DELETE');
    });

    it('ignores 404 (already deleted)', async () => {
      mockFetch.mockResolvedValue(makeErrorResponse(404));

      const adapter = makeAdapter();
      await expect(adapter.deleteItem('missing-item')).resolves.not.toThrow();
    });

    it('throws SyncAuthError on 401', async () => {
      mockFetch.mockResolvedValue(makeErrorResponse(401));

      const adapter = makeAdapter();
      await expect(adapter.deleteItem('item-abc')).rejects.toThrow(SyncAuthError);
    });

    it('throws SyncAuthError on 403', async () => {
      mockFetch.mockResolvedValue(makeErrorResponse(403));

      const adapter = makeAdapter();
      await expect(adapter.deleteItem('item-abc')).rejects.toThrow(SyncAuthError);
    });
  });

  // -------------------------------------------------------------------------
  // listItems
  // -------------------------------------------------------------------------

  describe('listItems()', () => {
    it('returns empty array when folder not found (404)', async () => {
      mockFetch.mockResolvedValue(makeErrorResponse(404));

      const adapter = makeAdapter();
      const result = await adapter.listItems();

      expect(result).toEqual([]);
    });

    it('returns IDs by stripping .bin suffix from entry names', async () => {
      mockFetch.mockResolvedValue(
        makeJsonResponse({
          value: [
            { name: 'abc123.bin', file: {} },
            { name: 'def456.bin', file: {} },
          ],
        }),
      );

      const adapter = makeAdapter();
      const result = await adapter.listItems();

      expect(result.sort()).toEqual(['abc123', 'def456'].sort());
    });

    it('filters out non-.bin entries', async () => {
      mockFetch.mockResolvedValue(
        makeJsonResponse({
          value: [
            { name: 'abc123.bin', file: {} },
            { name: 'manifest.json', file: {} },
            { name: 'subfolder', folder: {} },
          ],
        }),
      );

      const adapter = makeAdapter();
      const result = await adapter.listItems();

      expect(result).toEqual(['abc123']);
    });

    it('handles @odata.nextLink pagination', async () => {
      // First page with nextLink
      mockFetch.mockResolvedValueOnce(
        makeJsonResponse({
          value: [{ name: 'item1.bin', file: {} }],
          '@odata.nextLink': 'https://graph.microsoft.com/v1.0/next-page-url',
        }),
      );
      // Second page (no nextLink)
      mockFetch.mockResolvedValueOnce(
        makeJsonResponse({
          value: [{ name: 'item2.bin', file: {} }],
        }),
      );

      const adapter = makeAdapter();
      const result = await adapter.listItems();

      expect(result.sort()).toEqual(['item1', 'item2'].sort());
      expect(mockFetch).toHaveBeenCalledTimes(2);

      // Second call should use nextLink URL
      const [url2] = mockFetch.mock.calls[1] as [string, RequestInit];
      expect(url2).toBe('https://graph.microsoft.com/v1.0/next-page-url');
    });

    it('returns empty array when folder has no .bin entries', async () => {
      mockFetch.mockResolvedValue(
        makeJsonResponse({
          value: [],
        }),
      );

      const adapter = makeAdapter();
      const result = await adapter.listItems();

      expect(result).toEqual([]);
    });

    it('GETs from Graph API approot items children endpoint', async () => {
      mockFetch.mockResolvedValue(makeJsonResponse({ value: [] }));

      const adapter = makeAdapter();
      await adapter.listItems();

      const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toContain('graph.microsoft.com');
      expect(url).toContain('items');
      expect(url).toContain('children');
      expect(opts.method).toBe('GET');
    });

    it('throws SyncAuthError on 401', async () => {
      mockFetch.mockResolvedValue(makeErrorResponse(401));

      const adapter = makeAdapter();
      await expect(adapter.listItems()).rejects.toThrow(SyncAuthError);
    });

    it('throws SyncAuthError on 403', async () => {
      mockFetch.mockResolvedValue(makeErrorResponse(403));

      const adapter = makeAdapter();
      await expect(adapter.listItems()).rejects.toThrow(SyncAuthError);
    });
  });
});
