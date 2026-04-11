import { encryptVaultBlob } from './vault-blob.js';
import type { Argon2Params } from '../crypto/constants.js';
import type { ISyncAdapter, SyncManifest } from './types.js';
import { pMap } from '../utils/concurrency.js';

export interface DeleteCloudVaultResult {
  success: boolean;
  failedItems: string[];
}

/** Maximum number of concurrent item deletions. */
const DELETE_CONCURRENCY = 5;

/**
 * Best-effort deletion of all items in a cloud vault.
 *
 * Lists every item via the adapter's `listItems()` and deletes them in
 * parallel batches of up to {@link DELETE_CONCURRENCY}. Individual deletion
 * failures are collected but never abort the run — remaining items are
 * still attempted. After deletion, an encrypted empty manifest is written
 * when the caller provides MEK/salt/header/argon2 params.
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

  await pMap(
    itemIds,
    async (id) => {
      try {
        await adapter.deleteItem(id);
      } catch {
        failedItems.push(id);
      }
    },
    DELETE_CONCURRENCY,
  );

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
