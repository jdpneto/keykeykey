import { describe, it, expect, vi } from 'vitest';
import { collectVaultFiles } from './collect-vault-files.js';
import type { ISyncAdapter } from '../sync/types.js';

function mockAdapter(overrides: Partial<ISyncAdapter> = {}): ISyncAdapter {
  return {
    readVaultBlob: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
    writeVaultBlob: vi.fn(),
    readItem: vi.fn().mockImplementation(async (id: string) => {
      if (id === 'item-1') return new Uint8Array([10, 20]);
      if (id === 'item-2') return new Uint8Array([30, 40]);
      return null;
    }),
    writeItem: vi.fn(),
    deleteItem: vi.fn(),
    listItems: vi.fn().mockResolvedValue(['item-1', 'item-2']),
    ...overrides,
  };
}

describe('collectVaultFiles', () => {
  it('collects vault.enc and all items', async () => {
    const adapter = mockAdapter();
    const files = await collectVaultFiles(adapter);
    expect(files.size).toBe(3);
    expect(files.has('vault.enc')).toBe(true);
    expect(files.has('items/item-1')).toBe(true);
    expect(files.has('items/item-2')).toBe(true);
    expect(Buffer.from(files.get('vault.enc')!)).toEqual(Buffer.from([1, 2, 3]));
  });

  it('throws if vault.enc is missing', async () => {
    const adapter = mockAdapter({ readVaultBlob: vi.fn().mockResolvedValue(null) });
    await expect(collectVaultFiles(adapter)).rejects.toThrow('No vault blob found');
  });

  it('skips items that return null', async () => {
    const adapter = mockAdapter({
      listItems: vi.fn().mockResolvedValue(['item-1', 'missing']),
      readItem: vi.fn().mockImplementation(async (id: string) => {
        if (id === 'item-1') return new Uint8Array([10]);
        return null;
      }),
    });
    const files = await collectVaultFiles(adapter);
    expect(files.size).toBe(2);
  });
});
