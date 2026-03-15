import type { ISyncAdapter } from './types.js';

export interface CloudConflictResult {
  hasConflict: boolean;
  remoteVaultId?: string;
}

export async function checkCloudConflict(
  adapter: ISyncAdapter,
  localVaultId: string,
): Promise<CloudConflictResult> {
  const manifest = await adapter.readManifest();
  if (!manifest || !manifest.vaultId) {
    return { hasConflict: false };
  }
  if (manifest.vaultId === localVaultId) {
    return { hasConflict: false };
  }
  return { hasConflict: true, remoteVaultId: manifest.vaultId };
}
