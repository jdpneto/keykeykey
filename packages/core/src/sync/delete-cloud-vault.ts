import type { ISyncAdapter } from './types.js';

export interface DeleteCloudVaultResult {
  success: boolean;
  failedItems: string[];
}

/**
 * Best-effort deletion of all items in a cloud vault.
 *
 * Iterates over every item returned by the adapter's `listItems()`,
 * attempts to delete each one, and then writes an empty manifest.
 * Individual item deletion failures are collected but do not abort
 * the process — remaining items are still attempted.
 */
export async function deleteCloudVault(adapter: ISyncAdapter): Promise<DeleteCloudVaultResult> {
  const failedItems: string[] = [];
  const itemIds = await adapter.listItems();

  for (const id of itemIds) {
    try {
      await adapter.deleteItem(id);
    } catch {
      failedItems.push(id);
    }
  }

  await adapter.writeManifest({
    version: 2,
    lastModified: new Date().toISOString(),
    items: {},
    tombstones: {},
  });

  return { success: failedItems.length === 0, failedItems };
}
