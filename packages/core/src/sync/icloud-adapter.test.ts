import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ICloudAdapter } from './icloud-adapter.js';
import type { ICloudFs } from './icloud-adapter.js';
import type { SyncManifest } from './types.js';

const makeFs = (): { [K in keyof ICloudFs]: ReturnType<typeof vi.fn> } & ICloudFs => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  deleteFile: vi.fn(),
  listFiles: vi.fn(),
  exists: vi.fn(),
  mkdir: vi.fn(),
});

const BASE_PATH = '/icloud/keykeykey';

describe('ICloudAdapter', () => {
  let mockFs: ReturnType<typeof makeFs>;
  let adapter: ICloudAdapter;

  beforeEach(() => {
    mockFs = makeFs();
    adapter = new ICloudAdapter({ containerPath: BASE_PATH, fs: mockFs });
  });

  describe('readManifest()', () => {
    it('returns null when manifest file does not exist', async () => {
      mockFs.exists.mockResolvedValue(false);

      const result = await adapter.readManifest();

      expect(result).toBeNull();
      expect(mockFs.exists).toHaveBeenCalledWith(`${BASE_PATH}/manifest.json`);
    });

    it('parses and returns JSON when manifest exists', async () => {
      const manifest: SyncManifest = {
        version: 1,
        lastModified: '2024-01-01T00:00:00.000Z',
        items: {
          'item-1': { updatedAt: '2024-01-01T00:00:00.000Z', hash: 'abc123' },
        },
      };

      mockFs.exists.mockResolvedValue(true);
      mockFs.readFile.mockResolvedValue(JSON.stringify(manifest));

      const result = await adapter.readManifest();

      expect(result).toEqual(manifest);
      expect(mockFs.readFile).toHaveBeenCalledWith(`${BASE_PATH}/manifest.json`);
    });

    it('returns null when manifest JSON is malformed', async () => {
      mockFs.exists.mockResolvedValue(true);
      mockFs.readFile.mockResolvedValue('not-valid-json{{{');

      const result = await adapter.readManifest();

      expect(result).toBeNull();
    });
  });

  describe('writeManifest()', () => {
    it('creates the base directory and writes JSON to the correct path', async () => {
      const manifest: SyncManifest = {
        version: 1,
        lastModified: '2024-01-01T00:00:00.000Z',
        items: {},
      };

      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.writeFile.mockResolvedValue(undefined);

      await adapter.writeManifest(manifest);

      expect(mockFs.mkdir).toHaveBeenCalledWith(BASE_PATH);
      expect(mockFs.writeFile).toHaveBeenCalledWith(
        `${BASE_PATH}/manifest.json`,
        JSON.stringify(manifest),
      );
    });
  });

  describe('readItem()', () => {
    it('returns null when item file does not exist', async () => {
      mockFs.exists.mockResolvedValue(false);

      const result = await adapter.readItem('abc-123');

      expect(result).toBeNull();
      expect(mockFs.exists).toHaveBeenCalledWith(`${BASE_PATH}/items/abc-123.bin`);
    });

    it('returns a Uint8Array when the item exists as Uint8Array', async () => {
      const data = new Uint8Array([10, 20, 30]);
      mockFs.exists.mockResolvedValue(true);
      mockFs.readFile.mockResolvedValue(data);

      const result = await adapter.readItem('abc-123');

      expect(result).toBeInstanceOf(Uint8Array);
      expect(result).toEqual(data);
    });

    it('returns a Uint8Array when the item exists as a string (base64-like)', async () => {
      // Some platform fs impls may return strings; adapter should wrap them
      mockFs.exists.mockResolvedValue(true);
      mockFs.readFile.mockResolvedValue('hello');

      const result = await adapter.readItem('abc-123');

      expect(result).toBeInstanceOf(Uint8Array);
    });

    it('reads from the correct path', async () => {
      mockFs.exists.mockResolvedValue(true);
      mockFs.readFile.mockResolvedValue(new Uint8Array([1]));

      await adapter.readItem('my-item-id');

      expect(mockFs.readFile).toHaveBeenCalledWith(`${BASE_PATH}/items/my-item-id.bin`);
    });
  });

  describe('writeItem()', () => {
    it('creates the items directory and writes to the correct path', async () => {
      const data = new Uint8Array([1, 2, 3]);
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.writeFile.mockResolvedValue(undefined);

      await adapter.writeItem('item-xyz', data);

      expect(mockFs.mkdir).toHaveBeenCalledWith(`${BASE_PATH}/items`);
      expect(mockFs.writeFile).toHaveBeenCalledWith(`${BASE_PATH}/items/item-xyz.bin`, data);
    });
  });

  describe('deleteItem()', () => {
    it('calls deleteFile with the correct path', async () => {
      mockFs.deleteFile.mockResolvedValue(undefined);

      await adapter.deleteItem('del-item');

      expect(mockFs.deleteFile).toHaveBeenCalledWith(`${BASE_PATH}/items/del-item.bin`);
    });

    it('does not throw if the file does not exist (swallows error)', async () => {
      mockFs.deleteFile.mockRejectedValue(new Error('file not found'));

      await expect(adapter.deleteItem('missing-item')).resolves.not.toThrow();
    });
  });

  describe('listItems()', () => {
    it('returns IDs extracted from .bin filenames', async () => {
      mockFs.listFiles.mockResolvedValue(['item-a.bin', 'item-b.bin', 'item-c.bin']);

      const ids = await adapter.listItems();

      expect(ids.sort()).toEqual(['item-a', 'item-b', 'item-c']);
      expect(mockFs.listFiles).toHaveBeenCalledWith(`${BASE_PATH}/items`);
    });

    it('filters out non-.bin files', async () => {
      mockFs.listFiles.mockResolvedValue(['item-a.bin', '.DS_Store', 'manifest.json', 'data.bin']);

      const ids = await adapter.listItems();

      expect(ids.sort()).toEqual(['data', 'item-a']);
    });

    it('returns empty array on error (e.g. directory does not exist)', async () => {
      mockFs.listFiles.mockRejectedValue(new Error('directory not found'));

      const ids = await adapter.listItems();

      expect(ids).toEqual([]);
    });

    it('returns empty array when no .bin files are present', async () => {
      mockFs.listFiles.mockResolvedValue([]);

      const ids = await adapter.listItems();

      expect(ids).toEqual([]);
    });
  });
});
