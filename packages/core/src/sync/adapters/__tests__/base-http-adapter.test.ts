import { describe, it, expect, vi } from 'vitest';
import { TemplateHttpAdapter } from '../base-http-adapter.js';

/**
 * In-memory fake adapter for testing BaseHttpAdapter's concrete methods.
 * Subclasses only need to implement the 4 primitives.
 */
class FakeCloudAdapter extends TemplateHttpAdapter {
  public blobs = new Map<string, Uint8Array>();
  public deletedPaths: string[] = [];

  protected async downloadBlob(path: string): Promise<Uint8Array | null> {
    return this.blobs.get(path) ?? null;
  }
  protected async uploadBlob(path: string, data: Uint8Array): Promise<void> {
    this.blobs.set(path, new Uint8Array(data));
  }
  protected async deleteBlob(path: string): Promise<void> {
    this.deletedPaths.push(path);
    this.blobs.delete(path);
  }
  protected async listBlobsRaw(): Promise<string[]> {
    return [...this.blobs.keys()];
  }
}

describe('TemplateHttpAdapter', () => {
  describe('vault blob', () => {
    it('readVaultBlob returns null when no blob saved', async () => {
      const adapter = new FakeCloudAdapter();
      expect(await adapter.readVaultBlob()).toBeNull();
    });

    it('writeVaultBlob then readVaultBlob round-trips data', async () => {
      const adapter = new FakeCloudAdapter();
      const data = new Uint8Array([1, 2, 3, 4]);
      await adapter.writeVaultBlob(data);
      const result = await adapter.readVaultBlob();
      expect(result).not.toBeNull();
      expect(Array.from(result!)).toEqual([1, 2, 3, 4]);
    });

    it('uses vault.enc as default blob name', async () => {
      const adapter = new FakeCloudAdapter();
      await adapter.writeVaultBlob(new Uint8Array([1]));
      expect(adapter.blobs.has('vault.enc')).toBe(true);
    });

    it('respects custom vaultBlobName option', async () => {
      class CustomAdapter extends FakeCloudAdapter {
        constructor() {
          super({ vaultBlobName: '/custom/vault.bin' });
        }
      }
      const adapter = new CustomAdapter();
      await adapter.writeVaultBlob(new Uint8Array([1]));
      expect(adapter.blobs.has('/custom/vault.bin')).toBe(true);
    });
  });

  describe('items', () => {
    it('writeItem then readItem round-trips data', async () => {
      const adapter = new FakeCloudAdapter();
      const data = new Uint8Array([5, 6, 7]);
      await adapter.writeItem('abc', data);
      const result = await adapter.readItem('abc');
      expect(result).not.toBeNull();
      expect(Array.from(result!)).toEqual([5, 6, 7]);
    });

    it('readItem returns null for missing item', async () => {
      const adapter = new FakeCloudAdapter();
      expect(await adapter.readItem('missing')).toBeNull();
    });

    it('writeItem uses ${id}.bin as default path', async () => {
      const adapter = new FakeCloudAdapter();
      await adapter.writeItem('abc', new Uint8Array([1]));
      expect(adapter.blobs.has('abc.bin')).toBe(true);
    });

    it('deleteItem calls deleteBlob with ${id}.bin', async () => {
      const adapter = new FakeCloudAdapter();
      await adapter.writeItem('abc', new Uint8Array([1]));
      await adapter.deleteItem('abc');
      expect(adapter.deletedPaths).toEqual(['abc.bin']);
      expect(adapter.blobs.has('abc.bin')).toBe(false);
    });

    it('listItems strips .bin extension', async () => {
      const adapter = new FakeCloudAdapter();
      await adapter.writeItem('one', new Uint8Array([1]));
      await adapter.writeItem('two', new Uint8Array([2]));
      const ids = await adapter.listItems();
      expect(ids.sort()).toEqual(['one', 'two']);
    });

    it('listItems filters out non-matching extensions', async () => {
      class CustomAdapter extends FakeCloudAdapter {
        async seedRaw(name: string, data: Uint8Array) {
          this.blobs.set(name, data);
        }
      }
      const adapter = new CustomAdapter();
      await adapter.seedRaw('file.bin', new Uint8Array([1]));
      await adapter.seedRaw('file.txt', new Uint8Array([1]));
      await adapter.seedRaw('vault.enc', new Uint8Array([1]));
      const ids = await adapter.listItems();
      expect(ids).toEqual(['file']);
    });

    it('respects custom itemExtension', async () => {
      class CustomAdapter extends FakeCloudAdapter {
        constructor() {
          super({ itemExtension: '.dat' });
        }
      }
      const adapter = new CustomAdapter();
      await adapter.writeItem('abc', new Uint8Array([1]));
      expect(adapter.blobs.has('abc.dat')).toBe(true);
      const ids = await adapter.listItems();
      expect(ids).toEqual(['abc']);
    });

    it('custom itemPath override changes item placement', async () => {
      class CustomAdapter extends FakeCloudAdapter {
        protected override itemPath(id: string): string {
          return '/items/' + id + this.itemExtension;
        }
      }
      const adapter = new CustomAdapter();
      await adapter.writeItem('abc', new Uint8Array([1]));
      expect(adapter.blobs.has('/items/abc.bin')).toBe(true);
    });
  });

  describe('legacy manifest', () => {
    it('readLegacyManifest returns null when blob missing', async () => {
      const adapter = new FakeCloudAdapter();
      expect(await adapter.readLegacyManifest!()).toBeNull();
    });

    it('readLegacyManifest parses JSON from manifest.json blob', async () => {
      const adapter = new FakeCloudAdapter();
      const manifest = { version: 1, items: [{ id: 'a', updatedAt: 't1' }] };
      const bytes = new TextEncoder().encode(JSON.stringify(manifest));
      adapter.blobs.set('manifest.json', bytes);
      const result = await adapter.readLegacyManifest!();
      expect(result).toEqual(manifest);
    });

    it('readLegacyManifest returns null on invalid JSON', async () => {
      const adapter = new FakeCloudAdapter();
      adapter.blobs.set('manifest.json', new TextEncoder().encode('not json'));
      expect(await adapter.readLegacyManifest!()).toBeNull();
    });

    it('deleteLegacyManifest calls deleteBlob with manifest.json', async () => {
      const adapter = new FakeCloudAdapter();
      await adapter.deleteLegacyManifest!();
      expect(adapter.deletedPaths).toEqual(['manifest.json']);
    });
  });

  describe('buildAuthHeaders', () => {
    it('returns empty object when no getAccessToken provided', async () => {
      class TestAdapter extends FakeCloudAdapter {
        async headers() {
          return this.buildAuthHeaders();
        }
      }
      const adapter = new TestAdapter();
      expect(await adapter.headers()).toEqual({});
    });

    it('returns Bearer header when getAccessToken provided', async () => {
      class TestAdapter extends FakeCloudAdapter {
        constructor() {
          super({ getAccessToken: async () => 'my-token' });
        }
        async headers() {
          return this.buildAuthHeaders();
        }
      }
      const adapter = new TestAdapter();
      expect(await adapter.headers()).toEqual({ Authorization: 'Bearer my-token' });
    });

    it('calls getAccessToken fresh on each call', async () => {
      const getAccessToken = vi
        .fn()
        .mockResolvedValueOnce('token-1')
        .mockResolvedValueOnce('token-2');
      class TestAdapter extends FakeCloudAdapter {
        constructor() {
          super({ getAccessToken });
        }
        async headers() {
          return this.buildAuthHeaders();
        }
      }
      const adapter = new TestAdapter();
      expect(await adapter.headers()).toEqual({ Authorization: 'Bearer token-1' });
      expect(await adapter.headers()).toEqual({ Authorization: 'Bearer token-2' });
    });
  });
});
