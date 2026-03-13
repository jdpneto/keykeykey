import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { GoogleDriveAdapter } from './google-drive-adapter.js';
import { SyncAuthError } from './errors.js';
import type { SyncManifest } from './types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeResponse(
  body: unknown,
  status = 200,
  isBytes = false,
): Response {
  const init: ResponseInit = { status };
  if (isBytes) {
    return {
      ok: status >= 200 && status < 300,
      status,
      arrayBuffer: () => Promise.resolve((body as Uint8Array).buffer),
      json: () => Promise.reject(new Error('not json')),
    } as unknown as Response;
  }
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    arrayBuffer: () => Promise.reject(new Error('not bytes')),
  } as unknown as Response;
}

const ACCESS_TOKEN = 'test-access-token';

function makeAdapter() {
  return new GoogleDriveAdapter({ getAccessToken: () => Promise.resolve(ACCESS_TOKEN) });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GoogleDriveAdapter', () => {
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
      // Empty search result → readManifest returns null
      mockFetch.mockResolvedValue(makeResponse({ files: [] }));

      const adapter = makeAdapter();
      await adapter.readManifest();

      const [, options] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect((options.headers as Record<string, string>)['Authorization']).toBe(
        `Bearer ${ACCESS_TOKEN}`,
      );
    });

    it('throws SyncAuthError on 401', async () => {
      mockFetch.mockResolvedValue(makeResponse({ error: 'Unauthorized' }, 401));

      const adapter = makeAdapter();
      await expect(adapter.readManifest()).rejects.toThrow(SyncAuthError);
    });

    it('throws SyncAuthError on 403', async () => {
      mockFetch.mockResolvedValue(makeResponse({ error: 'Forbidden' }, 403));

      const adapter = makeAdapter();
      await expect(adapter.readManifest()).rejects.toThrow(SyncAuthError);
    });
  });

  // -------------------------------------------------------------------------
  // readManifest
  // -------------------------------------------------------------------------

  describe('readManifest()', () => {
    it('returns null when file search returns empty files array', async () => {
      mockFetch.mockResolvedValue(makeResponse({ files: [] }));

      const adapter = makeAdapter();
      const result = await adapter.readManifest();

      expect(result).toBeNull();
    });

    it('returns parsed manifest when file exists', async () => {
      const manifest: SyncManifest = {
        version: 1,
        lastModified: '2024-01-01T00:00:00.000Z',
        items: { 'item-1': { updatedAt: '2024-01-01T00:00:00.000Z', hash: 'abc' } },
      };

      // First call: search for file → found with id
      mockFetch.mockResolvedValueOnce(makeResponse({ files: [{ id: 'file-abc' }] }));
      // Second call: GET ?alt=media → manifest bytes
      const bytes = new TextEncoder().encode(JSON.stringify(manifest));
      mockFetch.mockResolvedValueOnce(
        makeResponse(bytes, 200, true),
      );

      // Override arrayBuffer to return parsed json via text
      mockFetch.mockReset();
      mockFetch.mockResolvedValueOnce(makeResponse({ files: [{ id: 'file-abc' }] }));
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        arrayBuffer: () => Promise.resolve(new TextEncoder().encode(JSON.stringify(manifest)).buffer),
      } as unknown as Response);

      const adapter = makeAdapter();
      const result = await adapter.readManifest();

      expect(result).toEqual(manifest);
    });
  });

  // -------------------------------------------------------------------------
  // readItem
  // -------------------------------------------------------------------------

  describe('readItem()', () => {
    it('returns null when file not found', async () => {
      mockFetch.mockResolvedValue(makeResponse({ files: [] }));

      const adapter = makeAdapter();
      const result = await adapter.readItem('nonexistent');

      expect(result).toBeNull();
    });

    it('returns Uint8Array when file exists', async () => {
      const data = new Uint8Array([10, 20, 30]);

      mockFetch.mockResolvedValueOnce(makeResponse({ files: [{ id: 'bin-file-id' }] }));
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        arrayBuffer: () => Promise.resolve(data.buffer),
      } as unknown as Response);

      const adapter = makeAdapter();
      const result = await adapter.readItem('some-item-id');

      expect(result).toBeInstanceOf(Uint8Array);
      expect(result).toEqual(data);
    });
  });

  // -------------------------------------------------------------------------
  // writeItem
  // -------------------------------------------------------------------------

  describe('writeItem()', () => {
    it('creates new file (POST multipart) when not found', async () => {
      const data = new Uint8Array([1, 2, 3]);

      // First: search → not found
      mockFetch.mockResolvedValueOnce(makeResponse({ files: [] }));
      // Second: multipart POST → created
      mockFetch.mockResolvedValueOnce(makeResponse({ id: 'new-file-id' }, 200));

      const adapter = makeAdapter();
      await adapter.writeItem('item-abc', data);

      // Second call should be a POST to the upload endpoint
      const [url, opts] = mockFetch.mock.calls[1] as [string, RequestInit];
      expect(url).toContain('/upload/drive/v3/files');
      expect(opts.method).toBe('POST');
    });

    it('updates existing file (PATCH) when found', async () => {
      const data = new Uint8Array([4, 5, 6]);

      // First: search → found
      mockFetch.mockResolvedValueOnce(makeResponse({ files: [{ id: 'existing-file-id' }] }));
      // Second: PATCH upload
      mockFetch.mockResolvedValueOnce(makeResponse({ id: 'existing-file-id' }, 200));

      const adapter = makeAdapter();
      await adapter.writeItem('item-abc', data);

      const [url, opts] = mockFetch.mock.calls[1] as [string, RequestInit];
      expect(url).toContain('existing-file-id');
      expect(opts.method).toBe('PATCH');
    });

    it('caches fileId after first write so second write PATCHes without a new search', async () => {
      const data = new Uint8Array([7, 8, 9]);

      // First writeItem: search → not found, POST → created with id
      mockFetch.mockResolvedValueOnce(makeResponse({ files: [] }));
      mockFetch.mockResolvedValueOnce(makeResponse({ id: 'cached-id' }, 200));

      // Second writeItem: should PATCH directly (cache hit — no search)
      mockFetch.mockResolvedValueOnce(makeResponse({ id: 'cached-id' }, 200));

      const adapter = makeAdapter();
      await adapter.writeItem('item-xyz', data);
      await adapter.writeItem('item-xyz', data);

      expect(mockFetch).toHaveBeenCalledTimes(3);
      const [url, opts] = mockFetch.mock.calls[2] as [string, RequestInit];
      expect(url).toContain('cached-id');
      expect(opts.method).toBe('PATCH');
    });
  });

  // -------------------------------------------------------------------------
  // writeManifest
  // -------------------------------------------------------------------------

  describe('writeManifest()', () => {
    it('POSTs new manifest when none exists', async () => {
      const manifest: SyncManifest = {
        version: 1,
        lastModified: '2024-01-01T00:00:00.000Z',
        items: {},
      };

      mockFetch.mockResolvedValueOnce(makeResponse({ files: [] }));
      mockFetch.mockResolvedValueOnce(makeResponse({ id: 'manifest-id' }, 200));

      const adapter = makeAdapter();
      await adapter.writeManifest(manifest);

      const [url, opts] = mockFetch.mock.calls[1] as [string, RequestInit];
      expect(url).toContain('/upload/drive/v3/files');
      expect(opts.method).toBe('POST');
    });

    it('PATCHes existing manifest when it exists', async () => {
      const manifest: SyncManifest = {
        version: 2,
        lastModified: '2024-06-01T00:00:00.000Z',
        items: {},
      };

      mockFetch.mockResolvedValueOnce(makeResponse({ files: [{ id: 'manifest-id' }] }));
      mockFetch.mockResolvedValueOnce(makeResponse({ id: 'manifest-id' }, 200));

      const adapter = makeAdapter();
      await adapter.writeManifest(manifest);

      const [url, opts] = mockFetch.mock.calls[1] as [string, RequestInit];
      expect(url).toContain('manifest-id');
      expect(opts.method).toBe('PATCH');
    });
  });

  // -------------------------------------------------------------------------
  // deleteItem
  // -------------------------------------------------------------------------

  describe('deleteItem()', () => {
    it('deletes file by finding it first', async () => {
      // Search → found
      mockFetch.mockResolvedValueOnce(makeResponse({ files: [{ id: 'del-file-id' }] }));
      // DELETE → 204
      mockFetch.mockResolvedValueOnce({ ok: true, status: 204 } as Response);

      const adapter = makeAdapter();
      await adapter.deleteItem('item-to-delete');

      const [url, opts] = mockFetch.mock.calls[1] as [string, RequestInit];
      expect(url).toContain('del-file-id');
      expect(opts.method).toBe('DELETE');
    });

    it('does not throw when file not found', async () => {
      mockFetch.mockResolvedValue(makeResponse({ files: [] }));

      const adapter = makeAdapter();
      await expect(adapter.deleteItem('missing-item')).resolves.not.toThrow();
    });

    it('clears cache after successful delete', async () => {
      // Write to prime the cache
      mockFetch.mockResolvedValueOnce(makeResponse({ files: [] }));
      mockFetch.mockResolvedValueOnce(makeResponse({ id: 'cached-del-id' }, 200));

      // Delete: search from cache → DELETE
      mockFetch.mockResolvedValueOnce({ ok: true, status: 204 } as Response);

      // After delete, readItem should trigger a new search (cache cleared)
      mockFetch.mockResolvedValueOnce(makeResponse({ files: [] }));

      const adapter = makeAdapter();
      await adapter.writeItem('del-me', new Uint8Array([1]));
      await adapter.deleteItem('del-me');
      const result = await adapter.readItem('del-me');

      expect(result).toBeNull();
      // 4 calls: POST, DELETE, search after cache clear
      expect(mockFetch).toHaveBeenCalledTimes(4);
    });
  });

  // -------------------------------------------------------------------------
  // listItems
  // -------------------------------------------------------------------------

  describe('listItems()', () => {
    it('returns empty array when no .bin files found', async () => {
      mockFetch.mockResolvedValue(makeResponse({ files: [] }));

      const adapter = makeAdapter();
      const result = await adapter.listItems();

      expect(result).toEqual([]);
    });

    it('returns IDs by stripping .bin suffix from file names', async () => {
      mockFetch.mockResolvedValue(
        makeResponse({
          files: [
            { id: 'f1', name: 'abc123.bin' },
            { id: 'f2', name: 'def456.bin' },
          ],
        }),
      );

      const adapter = makeAdapter();
      const result = await adapter.listItems();

      expect(result.sort()).toEqual(['abc123', 'def456'].sort());
    });

    it('filters out non-.bin files', async () => {
      mockFetch.mockResolvedValue(
        makeResponse({
          files: [
            { id: 'f1', name: 'abc123.bin' },
            { id: 'f2', name: 'manifest.json' },
          ],
        }),
      );

      const adapter = makeAdapter();
      const result = await adapter.listItems();

      expect(result).toEqual(['abc123']);
    });

    it('queries appDataFolder space', async () => {
      mockFetch.mockResolvedValue(makeResponse({ files: [] }));

      const adapter = makeAdapter();
      await adapter.listItems();

      const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toContain('appDataFolder');
    });
  });

  // -------------------------------------------------------------------------
  // File name sanitization
  // -------------------------------------------------------------------------

  describe('file name sanitization', () => {
    it('escapes single quotes in file names used in Drive query strings', async () => {
      mockFetch.mockResolvedValue(makeResponse({ files: [] }));

      const adapter = makeAdapter();
      // This should not throw; the query should escape the quote
      await adapter.readItem("item-with'-quote");

      const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
      // The escaped \' is URL-encoded as %5C' or %5C%27 in the query param
      expect(url).toContain("%5C'");
    });

    it('escapes backslashes in file names', async () => {
      mockFetch.mockResolvedValue(makeResponse({ files: [] }));

      const adapter = makeAdapter();
      await adapter.readItem('item-with\\backslash');

      const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
      // The escaped \\ is URL-encoded as %5C%5C in the query param
      expect(url).toContain('%5C%5C');
    });
  });
});
