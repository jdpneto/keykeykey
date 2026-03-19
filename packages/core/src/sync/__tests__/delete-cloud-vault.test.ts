import { describe, it, expect, vi } from 'vitest';
import { deleteCloudVault } from '../delete-cloud-vault.js';
import type { ISyncAdapter } from '../types.js';
import type { Argon2Params } from '../../crypto/constants.js';
import { deriveMEK, generateSyncSalt, decryptVaultBlob } from '../vault-blob.js';

const TEST_PARAMS: Argon2Params = { t: 1, m: 256, p: 1, dkLen: 32 };
const TEST_HEADER_BYTES = new Uint8Array(64);

let sharedMek: Uint8Array;
let sharedSalt: Uint8Array;

async function ensureMek() {
  if (!sharedMek) {
    sharedSalt = generateSyncSalt();
    sharedMek = await deriveMEK('test-pass', sharedSalt, TEST_PARAMS);
  }
  return { mek: sharedMek, syncSalt: sharedSalt };
}

function createMockAdapter(itemIds: string[]): ISyncAdapter {
  let storedBlob: Uint8Array | null = null;
  return {
    readVaultBlob: vi.fn().mockImplementation(() => Promise.resolve(storedBlob)),
    writeVaultBlob: vi.fn().mockImplementation((data: Uint8Array) => {
      storedBlob = data;
      return Promise.resolve();
    }),
    readItem: vi.fn().mockResolvedValue(null),
    writeItem: vi.fn().mockResolvedValue(undefined),
    deleteItem: vi.fn().mockResolvedValue(undefined),
    listItems: vi.fn().mockResolvedValue(itemIds),
  };
}

describe('deleteCloudVault', () => {
  it('should delete all items and write an encrypted empty manifest', async () => {
    const { mek, syncSalt } = await ensureMek();
    const adapter = createMockAdapter(['item-1', 'item-2', 'item-3']);
    const result = await deleteCloudVault(adapter, mek, syncSalt, TEST_HEADER_BYTES, TEST_PARAMS);

    expect(result.success).toBe(true);
    expect(result.failedItems).toEqual([]);
    expect(adapter.deleteItem).toHaveBeenCalledTimes(3);
    expect(adapter.deleteItem).toHaveBeenCalledWith('item-1');
    expect(adapter.deleteItem).toHaveBeenCalledWith('item-2');
    expect(adapter.deleteItem).toHaveBeenCalledWith('item-3');
    expect(adapter.writeVaultBlob).toHaveBeenCalledTimes(1);

    // Verify the written blob is a valid encrypted manifest
    const writtenBlob = vi.mocked(adapter.writeVaultBlob).mock.calls[0][0] as Uint8Array;
    const decoded = decryptVaultBlob(writtenBlob, mek);
    expect(decoded.manifest.version).toBe(2);
    expect(decoded.manifest.items).toEqual({});
    expect(decoded.manifest.tombstones).toEqual({});
    expect(decoded.manifest.lastModified).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('should handle empty cloud vault', async () => {
    const { mek, syncSalt } = await ensureMek();
    const adapter = createMockAdapter([]);
    const result = await deleteCloudVault(adapter, mek, syncSalt, TEST_HEADER_BYTES, TEST_PARAMS);

    expect(result.success).toBe(true);
    expect(result.failedItems).toEqual([]);
    expect(adapter.deleteItem).not.toHaveBeenCalled();
    expect(adapter.writeVaultBlob).toHaveBeenCalledTimes(1);
  });

  it('should continue on individual item deletion failure (best-effort)', async () => {
    const { mek, syncSalt } = await ensureMek();
    const adapter = createMockAdapter(['item-1', 'item-2', 'item-3']);
    vi.mocked(adapter.deleteItem).mockRejectedValueOnce(new Error('network error'));

    const result = await deleteCloudVault(adapter, mek, syncSalt, TEST_HEADER_BYTES, TEST_PARAMS);

    expect(result.success).toBe(false);
    expect(result.failedItems).toEqual(['item-1']);
    // Should still attempt remaining items
    expect(adapter.deleteItem).toHaveBeenCalledTimes(3);
    // Should still write the encrypted empty manifest
    expect(adapter.writeVaultBlob).toHaveBeenCalledTimes(1);
  });

  it('should report all failures when multiple items fail', async () => {
    const { mek, syncSalt } = await ensureMek();
    const adapter = createMockAdapter(['item-1', 'item-2', 'item-3']);
    vi.mocked(adapter.deleteItem)
      .mockRejectedValueOnce(new Error('fail 1'))
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('fail 3'));

    const result = await deleteCloudVault(adapter, mek, syncSalt, TEST_HEADER_BYTES, TEST_PARAMS);

    expect(result.success).toBe(false);
    expect(result.failedItems).toEqual(['item-1', 'item-3']);
    expect(adapter.deleteItem).toHaveBeenCalledTimes(3);
    expect(adapter.writeVaultBlob).toHaveBeenCalledTimes(1);
  });

  it('should skip writing vault blob when no MEK params are provided', async () => {
    const adapter = createMockAdapter(['item-1']);
    const result = await deleteCloudVault(adapter);

    expect(result.success).toBe(true);
    expect(adapter.deleteItem).toHaveBeenCalledTimes(1);
    expect(adapter.writeVaultBlob).not.toHaveBeenCalled();
  });
});
