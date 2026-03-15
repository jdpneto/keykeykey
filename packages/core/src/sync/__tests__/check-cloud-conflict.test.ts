import { describe, it, expect, vi } from 'vitest';
import { checkCloudConflict } from '../check-cloud-conflict.js';
import type { ISyncAdapter } from '../types.js';

describe('checkCloudConflict', () => {
  it('should return no conflict when cloud is empty', async () => {
    const adapter = {
      readManifest: vi.fn().mockResolvedValue(null),
    } as unknown as ISyncAdapter;
    const result = await checkCloudConflict(adapter, 'local-id');
    expect(result.hasConflict).toBe(false);
  });

  it('should return no conflict when vaultIds match', async () => {
    const adapter = {
      readManifest: vi
        .fn()
        .mockResolvedValue({ vaultId: 'same-id', version: 2, lastModified: '', items: {} }),
    } as unknown as ISyncAdapter;
    const result = await checkCloudConflict(adapter, 'same-id');
    expect(result.hasConflict).toBe(false);
  });

  it('should return conflict when vaultIds differ', async () => {
    const adapter = {
      readManifest: vi
        .fn()
        .mockResolvedValue({ vaultId: 'remote-id', version: 2, lastModified: '', items: {} }),
    } as unknown as ISyncAdapter;
    const result = await checkCloudConflict(adapter, 'local-id');
    expect(result.hasConflict).toBe(true);
    expect(result.remoteVaultId).toBe('remote-id');
  });

  it('should return no conflict when remote has no vaultId (legacy)', async () => {
    const adapter = {
      readManifest: vi.fn().mockResolvedValue({ version: 2, lastModified: '', items: {} }),
    } as unknown as ISyncAdapter;
    const result = await checkCloudConflict(adapter, 'local-id');
    expect(result.hasConflict).toBe(false);
  });
});
