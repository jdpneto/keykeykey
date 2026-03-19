import { decryptVaultBlob } from './vault-blob.js';
import type { ISyncAdapter } from './types.js';

export interface CloudConflictResult {
  hasConflict: boolean;
  remoteVaultId?: string;
  /** True when the check could not be performed (e.g. no MEK or decrypt failure). */
  inconclusive?: boolean;
}

export async function checkCloudConflict(
  adapter: ISyncAdapter,
  localVaultId: string,
  mek?: Uint8Array,
): Promise<CloudConflictResult> {
  const raw = await adapter.readVaultBlob();
  if (!raw) return { hasConflict: false };

  if (!mek) return { hasConflict: false, inconclusive: true };

  try {
    const decoded = decryptVaultBlob(raw, mek);
    if (!decoded.manifest.vaultId) return { hasConflict: false };
    if (decoded.manifest.vaultId === localVaultId) return { hasConflict: false };
    return { hasConflict: true, remoteVaultId: decoded.manifest.vaultId };
  } catch {
    return { hasConflict: false, inconclusive: true };
  }
}
