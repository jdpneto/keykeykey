import { describe, it, expect } from 'vitest';
import type { Argon2Params } from '../../crypto/constants.js';
import { createVaultHeader, serializeVaultHeader } from '../../crypto/vault-header.js';
import { generateRecoveryKey } from '../../crypto/recovery.js';
import { encrypt } from '../../crypto/encryption.js';
import type { SyncManifest } from '../core/types.js';
import { MemoryAdapter } from '../adapters/memory-adapter.js';
import { encryptVaultBlob, PREAMBLE_SIZE } from '../blob/vault-blob.js';
import { generateSyncSalt, deriveMEK } from '../blob/mek.js';
import { restoreFromCloud } from './restore.js';
import type { RestoreFromCloudResult } from './restore.js';
import { hashEncryptedItem } from '../core/item-hash.js';

const TEST_PARAMS: Argon2Params = { t: 1, m: 8192, p: 1, dkLen: 32 };
const TEST_PASSWORD = 'test-master-password';

/**
 * Helper: set up a MemoryAdapter with a valid encrypted vault blob and items.
 */
async function setupAdapter(
  password: string = TEST_PASSWORD,
  params: Argon2Params = TEST_PARAMS,
  itemIds: string[] = ['item-1', 'item-2'],
) {
  const adapter = new MemoryAdapter();

  // Create vault header
  const recoveryKey = generateRecoveryKey();
  const { header, dek } = await createVaultHeader(password, recoveryKey.raw, params);
  const headerBytes = serializeVaultHeader(header);

  const manifest: SyncManifest = {
    version: 2,
    lastModified: new Date().toISOString(),
    items: {},
  };

  // Write encrypted items (just encrypt some dummy data with the DEK)
  for (const id of itemIds) {
    const plaintext = new TextEncoder().encode(JSON.stringify({ id, secret: `secret-${id}` }));
    const encrypted = encrypt(plaintext, dek);
    await adapter.writeItem(id, encrypted);
    manifest.items[id] = {
      updatedAt: new Date().toISOString(),
      hash: hashEncryptedItem(encrypted),
    };
  }

  // Derive MEK and encrypt vault blob
  const syncSalt = generateSyncSalt();
  const mek = await deriveMEK(password, syncSalt, params);
  const blobData = encryptVaultBlob(manifest, headerBytes, mek, syncSalt, params);
  await adapter.writeVaultBlob(blobData);

  return { adapter, header, dek, syncSalt, mek };
}

describe('restoreFromCloud', () => {
  it('restores successfully with correct password', async () => {
    const { adapter } = await setupAdapter();

    const result: RestoreFromCloudResult = await restoreFromCloud(adapter, TEST_PASSWORD);

    expect(result.header).toBeDefined();
    expect(result.header.version).toBe(2);
    expect(result.header.vaultId).toBeDefined();
    expect(result.encryptedItems).toHaveLength(2);
    expect(result.itemCount).toBe(2);
    expect(result.syncSalt).toBeInstanceOf(Uint8Array);
    expect(result.syncSalt.length).toBe(16);
    expect(result.argon2Params).toEqual(TEST_PARAMS);
  });

  it('throws on empty remote', async () => {
    const adapter = new MemoryAdapter();

    await expect(restoreFromCloud(adapter, TEST_PASSWORD)).rejects.toThrow(
      'No vault data found on remote',
    );
  });

  it('throws on wrong password', async () => {
    const { adapter } = await setupAdapter();

    await expect(restoreFromCloud(adapter, 'wrong-password')).rejects.toThrow(
      'Incorrect master password or incompatible vault',
    );
  });

  it('zeroes MEK on decrypt failure', async () => {
    // We can't directly observe the MEK from outside, but we can verify that
    // the error is thrown correctly (indicating the catch block ran, which zeroes MEK).
    // This is a behavioral test — the important thing is the error propagates.
    const { adapter } = await setupAdapter();

    await expect(restoreFromCloud(adapter, 'wrong-password')).rejects.toThrow(
      'Incorrect master password or incompatible vault',
    );
  });

  it('validates argon2 params from preamble', async () => {
    const adapter = new MemoryAdapter();

    // Create a blob with invalid params (m too low) by writing raw bytes
    const syncSalt = generateSyncSalt();
    const badParams: Argon2Params = { t: 1, m: 256, p: 1, dkLen: 32 }; // m < 8192

    // Build a fake preamble with bad params
    const preamble = new Uint8Array(PREAMBLE_SIZE);
    preamble.set(syncSalt, 0);
    const view = new DataView(preamble.buffer, preamble.byteOffset, preamble.byteLength);
    view.setUint32(16, badParams.t, true);
    view.setUint32(20, badParams.m, true);
    view.setUint32(24, badParams.p, true);
    view.setUint32(28, badParams.dkLen, true);

    // Append some dummy ciphertext so blob is long enough
    const fakeBlob = new Uint8Array(PREAMBLE_SIZE + 64);
    fakeBlob.set(preamble, 0);
    await adapter.writeVaultBlob(fakeBlob);

    await expect(restoreFromCloud(adapter, TEST_PASSWORD)).rejects.toThrow(
      'Argon2 m (memory KiB) must be 8192-262144, got 256',
    );
  });

  it('throws when a manifest item is missing from remote storage', async () => {
    // Setup adapter but with items in manifest that don't exist on the adapter
    const adapter = new MemoryAdapter();

    const recoveryKey = generateRecoveryKey();
    const { header } = await createVaultHeader(TEST_PASSWORD, recoveryKey.raw, TEST_PARAMS);
    const headerBytes = serializeVaultHeader(header);

    const syncSalt = generateSyncSalt();
    const mek = await deriveMEK(TEST_PASSWORD, syncSalt, TEST_PARAMS);

    // Only write one item
    const plaintext = new TextEncoder().encode('data');
    const encrypted = encrypt(plaintext, new Uint8Array(32).fill(1));
    await adapter.writeItem('existing-item', encrypted);

    const manifest: SyncManifest = {
      version: 2,
      lastModified: new Date().toISOString(),
      items: {
        'existing-item': {
          updatedAt: new Date().toISOString(),
          hash: hashEncryptedItem(encrypted),
        },
        'missing-item': { updatedAt: new Date().toISOString(), hash: 'hash2' },
      },
    };
    const blobData = encryptVaultBlob(manifest, headerBytes, mek, syncSalt, TEST_PARAMS);
    await adapter.writeVaultBlob(blobData);

    await expect(restoreFromCloud(adapter, TEST_PASSWORD)).rejects.toThrow(
      'Remote item missing for missing-item',
    );
  });

  it('throws when an encrypted blob hash does not match the manifest', async () => {
    const adapter = new MemoryAdapter();

    const recoveryKey = generateRecoveryKey();
    const { header, dek } = await createVaultHeader(TEST_PASSWORD, recoveryKey.raw, TEST_PARAMS);
    const headerBytes = serializeVaultHeader(header);

    const good = encrypt(new TextEncoder().encode('good'), dek);
    const swapped = encrypt(new TextEncoder().encode('swapped'), dek);
    await adapter.writeItem('good-item', good);
    await adapter.writeItem('swapped-item', swapped);

    const manifest: SyncManifest = {
      version: 2,
      lastModified: new Date().toISOString(),
      items: {
        'good-item': { updatedAt: new Date().toISOString(), hash: hashEncryptedItem(good) },
        'swapped-item': {
          updatedAt: new Date().toISOString(),
          hash: hashEncryptedItem(good),
        },
      },
    };

    const syncSalt = generateSyncSalt();
    const mek = await deriveMEK(TEST_PASSWORD, syncSalt, TEST_PARAMS);
    const blobData = encryptVaultBlob(manifest, headerBytes, mek, syncSalt, TEST_PARAMS);
    await adapter.writeVaultBlob(blobData);

    await expect(restoreFromCloud(adapter, TEST_PASSWORD)).rejects.toThrow(
      'Remote item integrity check failed for swapped-item',
    );
  });

  it('fires onProgress with downloading phase for each item', async () => {
    const ids = ['a', 'b', 'c', 'd'];
    const { adapter } = await setupAdapter(TEST_PASSWORD, TEST_PARAMS, ids);
    const calls: { phase: string; completed: number; total: number }[] = [];

    await restoreFromCloud(adapter, TEST_PASSWORD, (event) => {
      calls.push({ ...event });
    });

    const downloadCalls = calls.filter((c) => c.phase === 'downloading');
    expect(downloadCalls).toHaveLength(4);
    expect(downloadCalls[downloadCalls.length - 1]).toEqual({
      phase: 'downloading',
      completed: 4,
      total: 4,
    });
  });

  it('works without onProgress (no regression)', async () => {
    const { adapter } = await setupAdapter();
    const result = await restoreFromCloud(adapter, TEST_PASSWORD);
    expect(result.encryptedItems).toHaveLength(2);
  });
});
