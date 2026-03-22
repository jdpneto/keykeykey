/**
 * Collect vault files from a sync adapter into a Map for backup export.
 *
 * Reads vault.enc (the encrypted vault blob) and all individual encrypted items.
 */

import type { ISyncAdapter } from '../sync/types.js';

/**
 * Read all vault files from a sync adapter.
 *
 * @param adapter - The sync adapter to read from
 * @returns Map of relative path → file bytes ("vault.enc", "items/{id}")
 * @throws {Error} If vault.enc is not found
 */
export async function collectVaultFiles(
  adapter: ISyncAdapter,
): Promise<Map<string, Uint8Array>> {
  const files = new Map<string, Uint8Array>();

  const vaultBlob = await adapter.readVaultBlob();
  if (!vaultBlob) {
    throw new Error('No vault blob found. Is the vault synced?');
  }
  files.set('vault.enc', vaultBlob);

  const itemIds = await adapter.listItems();
  for (const id of itemIds) {
    const data = await adapter.readItem(id);
    if (data) {
      files.set(`items/${id}`, data);
    }
  }

  return files;
}
