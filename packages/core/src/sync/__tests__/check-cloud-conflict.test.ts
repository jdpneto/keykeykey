import { describe, it, expect, vi } from 'vitest';
import { checkCloudConflict } from '../check-cloud-conflict.js';
import type { ISyncAdapter } from '../types.js';
import type { Argon2Params } from '../../crypto/constants.js';
import { deriveMEK, generateSyncSalt, encryptVaultBlob } from '../vault-blob.js';
import type { SyncManifest } from '../types.js';

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

function createMockAdapter(vaultBlob: Uint8Array | null): ISyncAdapter {
  return {
    readVaultBlob: vi.fn().mockResolvedValue(vaultBlob),
    writeVaultBlob: vi.fn().mockResolvedValue(undefined),
    readItem: vi.fn().mockResolvedValue(null),
    writeItem: vi.fn().mockResolvedValue(undefined),
    deleteItem: vi.fn().mockResolvedValue(undefined),
    listItems: vi.fn().mockResolvedValue([]),
  };
}

describe('checkCloudConflict', () => {
  it('should return no conflict when cloud is empty', async () => {
    const { mek } = await ensureMek();
    const adapter = createMockAdapter(null);
    const result = await checkCloudConflict(adapter, 'local-id', mek);
    expect(result.hasConflict).toBe(false);
  });

  it('should return no conflict when vaultIds match', async () => {
    const { mek, syncSalt } = await ensureMek();
    const manifest: SyncManifest = {
      vaultId: 'same-id',
      version: 2,
      lastModified: '',
      items: {},
    };
    const blob = encryptVaultBlob(manifest, TEST_HEADER_BYTES, mek, syncSalt, TEST_PARAMS);
    const adapter = createMockAdapter(blob);
    const result = await checkCloudConflict(adapter, 'same-id', mek);
    expect(result.hasConflict).toBe(false);
  });

  it('should return conflict when vaultIds differ', async () => {
    const { mek, syncSalt } = await ensureMek();
    const manifest: SyncManifest = {
      vaultId: 'remote-id',
      version: 2,
      lastModified: '',
      items: {},
    };
    const blob = encryptVaultBlob(manifest, TEST_HEADER_BYTES, mek, syncSalt, TEST_PARAMS);
    const adapter = createMockAdapter(blob);
    const result = await checkCloudConflict(adapter, 'local-id', mek);
    expect(result.hasConflict).toBe(true);
    expect(result.remoteVaultId).toBe('remote-id');
  });

  it('should return no conflict when remote has no vaultId (legacy)', async () => {
    const { mek, syncSalt } = await ensureMek();
    const manifest: SyncManifest = { version: 2, lastModified: '', items: {} };
    const blob = encryptVaultBlob(manifest, TEST_HEADER_BYTES, mek, syncSalt, TEST_PARAMS);
    const adapter = createMockAdapter(blob);
    const result = await checkCloudConflict(adapter, 'local-id', mek);
    expect(result.hasConflict).toBe(false);
  });

  it('should return no conflict when no mek is provided', async () => {
    const { mek, syncSalt } = await ensureMek();
    const manifest: SyncManifest = {
      vaultId: 'remote-id',
      version: 2,
      lastModified: '',
      items: {},
    };
    const blob = encryptVaultBlob(manifest, TEST_HEADER_BYTES, mek, syncSalt, TEST_PARAMS);
    const adapter = createMockAdapter(blob);
    const result = await checkCloudConflict(adapter, 'local-id');
    expect(result.hasConflict).toBe(false);
  });
});
