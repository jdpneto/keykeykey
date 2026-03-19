import { encryptVaultBlob } from './vault-blob.js';
import type { Argon2Params } from '../crypto/constants.js';
import type { ISyncAdapter, SyncManifest } from './types.js';

export interface DeleteCloudVaultResult {
  success: boolean;
  failedItems: string[];
}

/**
 * Best-effort deletion of all items in a cloud vault.
 *
 * Iterates over every item returned by the adapter's `listItems()`,
 * attempts to delete each one, and then writes an encrypted empty manifest.
 * Individual item deletion failures are collected but do not abort
 * the process — remaining items are still attempted.
 */
export async function deleteCloudVault(
  adapter: ISyncAdapter,
  mek?: Uint8Array,
  syncSalt?: Uint8Array,
  vaultHeaderBytes?: Uint8Array,
  argon2Params?: Argon2Params,
): Promise<DeleteCloudVaultResult> {
  const failedItems: string[] = [];
  const itemIds = await adapter.listItems();

  for (const id of itemIds) {
    try {
      await adapter.deleteItem(id);
    } catch {
      failedItems.push(id);
    }
  }

  if (mek && syncSalt && vaultHeaderBytes && argon2Params) {
    const emptyManifest: SyncManifest = {
      version: 2,
      lastModified: new Date().toISOString(),
      items: {},
      tombstones: {},
    };
    const blob = encryptVaultBlob(emptyManifest, vaultHeaderBytes, mek, syncSalt, argon2Params);
    await adapter.writeVaultBlob(blob);
  }

  return { success: failedItems.length === 0, failedItems };
}
