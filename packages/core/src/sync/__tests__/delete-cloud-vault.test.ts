import { describe, it, expect, vi } from 'vitest';
import { deleteCloudVault } from '../delete-cloud-vault.js';
import type { ISyncAdapter } from '../types.js';

function createMockAdapter(itemIds: string[]): ISyncAdapter {
  return {
    readManifest: vi.fn().mockResolvedValue(null),
    writeManifest: vi.fn().mockResolvedValue(undefined),
    readItem: vi.fn().mockResolvedValue(null),
    writeItem: vi.fn().mockResolvedValue(undefined),
    deleteItem: vi.fn().mockResolvedValue(undefined),
    listItems: vi.fn().mockResolvedValue(itemIds),
  };
}

describe('deleteCloudVault', () => {
  it('should delete all items and write an empty manifest', async () => {
    const adapter = createMockAdapter(['item-1', 'item-2', 'item-3']);
    const result = await deleteCloudVault(adapter);

    expect(result.success).toBe(true);
    expect(result.failedItems).toEqual([]);
    expect(adapter.deleteItem).toHaveBeenCalledTimes(3);
    expect(adapter.deleteItem).toHaveBeenCalledWith('item-1');
    expect(adapter.deleteItem).toHaveBeenCalledWith('item-2');
    expect(adapter.deleteItem).toHaveBeenCalledWith('item-3');
    expect(adapter.writeManifest).toHaveBeenCalledTimes(1);
    expect(adapter.writeManifest).toHaveBeenCalledWith(
      expect.objectContaining({
        version: 2,
        items: {},
        tombstones: {},
      }),
    );
    // lastModified should be an ISO string
    const manifestArg = vi.mocked(adapter.writeManifest).mock.calls[0][0];
    expect(manifestArg.lastModified).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('should handle empty cloud vault', async () => {
    const adapter = createMockAdapter([]);
    const result = await deleteCloudVault(adapter);

    expect(result.success).toBe(true);
    expect(result.failedItems).toEqual([]);
    expect(adapter.deleteItem).not.toHaveBeenCalled();
    expect(adapter.writeManifest).toHaveBeenCalledTimes(1);
    expect(adapter.writeManifest).toHaveBeenCalledWith(
      expect.objectContaining({
        version: 2,
        items: {},
        tombstones: {},
      }),
    );
  });

  it('should continue on individual item deletion failure (best-effort)', async () => {
    const adapter = createMockAdapter(['item-1', 'item-2', 'item-3']);
    vi.mocked(adapter.deleteItem).mockRejectedValueOnce(new Error('network error'));

    const result = await deleteCloudVault(adapter);

    expect(result.success).toBe(false);
    expect(result.failedItems).toEqual(['item-1']);
    // Should still attempt remaining items
    expect(adapter.deleteItem).toHaveBeenCalledTimes(3);
    // Should still write the empty manifest
    expect(adapter.writeManifest).toHaveBeenCalledTimes(1);
  });

  it('should report all failures when multiple items fail', async () => {
    const adapter = createMockAdapter(['item-1', 'item-2', 'item-3']);
    vi.mocked(adapter.deleteItem)
      .mockRejectedValueOnce(new Error('fail 1'))
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('fail 3'));

    const result = await deleteCloudVault(adapter);

    expect(result.success).toBe(false);
    expect(result.failedItems).toEqual(['item-1', 'item-3']);
    expect(adapter.deleteItem).toHaveBeenCalledTimes(3);
    expect(adapter.writeManifest).toHaveBeenCalledTimes(1);
  });
});
