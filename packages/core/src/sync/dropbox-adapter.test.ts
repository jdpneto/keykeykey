import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DropboxAdapter } from './dropbox-adapter.js';
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

function makeErrorResponse(status: number, errorTag?: string): Response {
  const body = errorTag
    ? { error_summary: `${errorTag}/...`, error: { '.tag': errorTag } }
    : { error_summary: 'error', error: { '.tag': 'other' } };
  return {
    ok: false,
    status,
    json: () => Promise.resolve(body),
    arrayBuffer: () => Promise.reject(new Error('not bytes')),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response;
}

const ACCESS_TOKEN = 'test-dropbox-token';

function makeAdapter() {
  return new DropboxAdapter({ getAccessToken: () => Promise.resolve(ACCESS_TOKEN) });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DropboxAdapter', () => {
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
      // 409 not_found → readVaultBlob returns null
      mockFetch.mockResolvedValue(makeErrorResponse(409, 'path/not_found'));

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
  });

  // -------------------------------------------------------------------------
  // readVaultBlob
  // -------------------------------------------------------------------------

  describe('readVaultBlob()', () => {
    it('returns null on 409 path/not_found', async () => {
      mockFetch.mockResolvedValue(makeErrorResponse(409, 'path/not_found'));

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

    it('POSTs to content API /download with correct path in header', async () => {
      const data = new Uint8Array([1, 2, 3]);
      mockFetch.mockResolvedValue(makeBytesResponse(data));

      const adapter = makeAdapter();
      await adapter.readVaultBlob();

      const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toContain('content.dropboxapi.com');
      expect(url).toContain('/download');
      expect(opts.method).toBe('POST');

      const apiArg = JSON.parse(
        (opts.headers as Record<string, string>)['Dropbox-API-Arg'] ?? '{}',
      ) as { path: string };
      expect(apiArg.path).toBe('/vault.enc');
    });
  });

  // -------------------------------------------------------------------------
  // writeVaultBlob
  // -------------------------------------------------------------------------

  describe('writeVaultBlob()', () => {
    it('uploads to content API /upload with overwrite mode', async () => {
      const data = new Uint8Array([1, 2, 3]);
      mockFetch.mockResolvedValue(makeJsonResponse({ name: 'vault.enc' }));

      const adapter = makeAdapter();
      await adapter.writeVaultBlob(data);

      const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toContain('content.dropboxapi.com');
      expect(url).toContain('/upload');
      expect(opts.method).toBe('POST');

      const apiArg = JSON.parse(
        (opts.headers as Record<string, string>)['Dropbox-API-Arg'] ?? '{}',
      ) as { path: string; mode: string };
      expect(apiArg.path).toBe('/vault.enc');
      expect(apiArg.mode).toBe('overwrite');
    });

    it('sends binary body with application/octet-stream Content-Type', async () => {
      const data = new Uint8Array([4, 5, 6]);
      mockFetch.mockResolvedValue(makeJsonResponse({ name: 'vault.enc' }));

      const adapter = makeAdapter();
      await adapter.writeVaultBlob(data);

      const [, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect((opts.headers as Record<string, string>)['Content-Type']).toBe(
        'application/octet-stream',
      );
      expect(opts.body).toEqual(data);
    });
  });

  // -------------------------------------------------------------------------
  // readItem
  // -------------------------------------------------------------------------

  describe('readItem()', () => {
    it('returns null on 409 path/not_found', async () => {
      mockFetch.mockResolvedValue(makeErrorResponse(409, 'path/not_found'));

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

    it('uses path /items/{id}.bin', async () => {
      const data = new Uint8Array([1]);
      mockFetch.mockResolvedValue(makeBytesResponse(data));

      const adapter = makeAdapter();
      await adapter.readItem('item-xyz');

      const [, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
      const apiArg = JSON.parse(
        (opts.headers as Record<string, string>)['Dropbox-API-Arg'] ?? '{}',
      ) as { path: string };
      expect(apiArg.path).toBe('/items/item-xyz.bin');
    });

    it('throws SyncAuthError on 401', async () => {
      mockFetch.mockResolvedValue(makeErrorResponse(401));

      const adapter = makeAdapter();
      await expect(adapter.readItem('item-abc')).rejects.toThrow(SyncAuthError);
    });
  });

  // -------------------------------------------------------------------------
  // writeItem
  // -------------------------------------------------------------------------

  describe('writeItem()', () => {
    it('uploads to /items/{id}.bin with overwrite mode', async () => {
      const data = new Uint8Array([1, 2, 3]);
      mockFetch.mockResolvedValue(makeJsonResponse({ name: 'item-abc.bin' }));

      const adapter = makeAdapter();
      await adapter.writeItem('item-abc', data);

      const [, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
      const apiArg = JSON.parse(
        (opts.headers as Record<string, string>)['Dropbox-API-Arg'] ?? '{}',
      ) as { path: string; mode: string };
      expect(apiArg.path).toBe('/items/item-abc.bin');
      expect(apiArg.mode).toBe('overwrite');
    });
  });

  // -------------------------------------------------------------------------
  // deleteItem
  // -------------------------------------------------------------------------

  describe('deleteItem()', () => {
    it('POSTs to RPC API /delete_v2 with correct path', async () => {
      mockFetch.mockResolvedValue(makeJsonResponse({ metadata: { name: 'item-abc.bin' } }));

      const adapter = makeAdapter();
      await adapter.deleteItem('item-abc');

      const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toContain('api.dropboxapi.com');
      expect(url).toContain('/delete_v2');
      expect(opts.method).toBe('POST');

      const body = JSON.parse(opts.body as string) as { path: string };
      expect(body.path).toBe('/items/item-abc.bin');
    });

    it('ignores 409 path/not_found (already deleted)', async () => {
      mockFetch.mockResolvedValue(makeErrorResponse(409, 'path/not_found'));

      const adapter = makeAdapter();
      await expect(adapter.deleteItem('missing-item')).resolves.not.toThrow();
    });

    it('throws SyncAuthError on 401', async () => {
      mockFetch.mockResolvedValue(makeErrorResponse(401));

      const adapter = makeAdapter();
      await expect(adapter.deleteItem('item-abc')).rejects.toThrow(SyncAuthError);
    });
  });

  // -------------------------------------------------------------------------
  // listItems
  // -------------------------------------------------------------------------

  describe('listItems()', () => {
    it('returns empty array when folder not found (409 path/not_found)', async () => {
      mockFetch.mockResolvedValue(makeErrorResponse(409, 'path/not_found'));

      const adapter = makeAdapter();
      const result = await adapter.listItems();

      expect(result).toEqual([]);
    });

    it('returns IDs by stripping .bin suffix from entry names', async () => {
      mockFetch.mockResolvedValue(
        makeJsonResponse({
          entries: [
            { '.tag': 'file', name: 'abc123.bin', path_lower: '/items/abc123.bin' },
            { '.tag': 'file', name: 'def456.bin', path_lower: '/items/def456.bin' },
          ],
          has_more: false,
          cursor: 'cursor-1',
        }),
      );

      const adapter = makeAdapter();
      const result = await adapter.listItems();

      expect(result.sort()).toEqual(['abc123', 'def456'].sort());
    });

    it('filters out non-.bin entries', async () => {
      mockFetch.mockResolvedValue(
        makeJsonResponse({
          entries: [
            { '.tag': 'file', name: 'abc123.bin', path_lower: '/items/abc123.bin' },
            { '.tag': 'file', name: 'manifest.json', path_lower: '/items/manifest.json' },
            { '.tag': 'folder', name: 'subfolder', path_lower: '/items/subfolder' },
          ],
          has_more: false,
          cursor: 'cursor-1',
        }),
      );

      const adapter = makeAdapter();
      const result = await adapter.listItems();

      expect(result).toEqual(['abc123']);
    });

    it('handles pagination with has_more and list_folder/continue', async () => {
      // First page
      mockFetch.mockResolvedValueOnce(
        makeJsonResponse({
          entries: [{ '.tag': 'file', name: 'item1.bin', path_lower: '/items/item1.bin' }],
          has_more: true,
          cursor: 'cursor-page1',
        }),
      );
      // Second page (continue)
      mockFetch.mockResolvedValueOnce(
        makeJsonResponse({
          entries: [{ '.tag': 'file', name: 'item2.bin', path_lower: '/items/item2.bin' }],
          has_more: false,
          cursor: 'cursor-page2',
        }),
      );

      const adapter = makeAdapter();
      const result = await adapter.listItems();

      expect(result.sort()).toEqual(['item1', 'item2'].sort());
      expect(mockFetch).toHaveBeenCalledTimes(2);

      // Second call should be list_folder/continue
      const [url2, opts2] = mockFetch.mock.calls[1] as [string, RequestInit];
      expect(url2).toContain('/list_folder/continue');
      const body = JSON.parse(opts2.body as string) as { cursor: string };
      expect(body.cursor).toBe('cursor-page1');
    });

    it('returns empty array when folder has no .bin entries', async () => {
      mockFetch.mockResolvedValue(
        makeJsonResponse({
          entries: [],
          has_more: false,
          cursor: 'cursor-empty',
        }),
      );

      const adapter = makeAdapter();
      const result = await adapter.listItems();

      expect(result).toEqual([]);
    });

    it('POSTs to RPC API /list_folder with /items path', async () => {
      mockFetch.mockResolvedValue(
        makeJsonResponse({ entries: [], has_more: false, cursor: 'c' }),
      );

      const adapter = makeAdapter();
      await adapter.listItems();

      const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toContain('api.dropboxapi.com');
      expect(url).toContain('/list_folder');
      expect(opts.method).toBe('POST');

      const body = JSON.parse(opts.body as string) as { path: string };
      expect(body.path).toBe('/items');
    });

    it('throws SyncAuthError on 401', async () => {
      mockFetch.mockResolvedValue(makeErrorResponse(401));

      const adapter = makeAdapter();
      await expect(adapter.listItems()).rejects.toThrow(SyncAuthError);
    });
  });
});
