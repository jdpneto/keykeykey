import { decryptVaultBlob } from './vault-blob.js';
import type { ISyncAdapter } from './types.js';

export interface CloudConflictResult {
  hasConflict: boolean;
  remoteVaultId?: string;
}

export async function checkCloudConflict(
  adapter: ISyncAdapter,
  localVaultId: string,
  mek?: Uint8Array,
): Promise<CloudConflictResult> {
  const raw = await adapter.readVaultBlob();
  if (!raw) return { hasConflict: false };

  if (!mek) return { hasConflict: false }; // Can't decrypt, assume no conflict

  try {
    const decoded = decryptVaultBlob(raw, mek);
    if (!decoded.manifest.vaultId) return { hasConflict: false };
    if (decoded.manifest.vaultId === localVaultId) return { hasConflict: false };
    return { hasConflict: true, remoteVaultId: decoded.manifest.vaultId };
  } catch {
    return { hasConflict: false }; // Can't decrypt = different password
  }
}
