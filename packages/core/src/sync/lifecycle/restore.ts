/**
 * Restore a vault from a cloud sync adapter.
 *
 * Downloads the encrypted vault blob, derives the MEK from the master password,
 * decrypts the blob, deserializes the vault header, and downloads all encrypted items.
 */

import type { Argon2Params } from '../../crypto/constants.js';
import type { VaultHeader } from '../../crypto/vault-header.js';
import { deserializeVaultHeader } from '../../crypto/vault-header.js';
import { fromBase64 } from '../../utils/base64.js';
import type { ISyncAdapter } from '../core/types.js';
import { hashEncryptedItem } from '../core/item-hash.js';
import type { VaultBlob } from '../blob/vault-blob.js';
import { readPreambleFromBlob, decryptVaultBlob } from '../blob/vault-blob.js';
import { validateArgon2Params, deriveMEK } from '../blob/mek.js';
import { pMap } from '../../utils/concurrency.js';

export interface RestoreProgressEvent {
  phase: 'downloading' | 'importing';
  completed: number;
  total: number;
}

export interface RestoreFromCloudResult {
  header: VaultHeader;
  encryptedItems: Uint8Array[];
  itemCount: number;
  syncSalt: Uint8Array;
  argon2Params: Argon2Params;
}

export async function restoreFromCloud(
  adapter: ISyncAdapter,
  masterPassword: string,
  onProgress?: (event: RestoreProgressEvent) => void,
): Promise<RestoreFromCloudResult> {
  // 1. Download vault blob
  const raw = await adapter.readVaultBlob();
  if (!raw) throw new Error('No vault data found on remote');

  // 2. Read preamble (salt + params)
  const { syncSalt, argon2Params } = readPreambleFromBlob(raw);
  validateArgon2Params(argon2Params);

  // 3. Derive MEK
  const mek = await deriveMEK(masterPassword, syncSalt, argon2Params);

  // 4. Decrypt vault blob (zero MEK on failure)
  let blob: VaultBlob;
  try {
    blob = decryptVaultBlob(raw, mek);
  } catch {
    mek.fill(0);
    throw new Error('Incorrect master password or incompatible vault');
  }

  // 5. Deserialize vault header
  const headerBytes = fromBase64(blob.vaultHeader);
  const header = deserializeVaultHeader(headerBytes);

  // 6. Download all encrypted items (concurrent, capped to avoid rate limits)
  const itemIds = Object.keys(blob.manifest.items);
  let results: (Uint8Array | null)[];
  try {
    results = await pMap(
      itemIds,
      async (id) => {
        const data = await adapter.readItem(id);
        if (!data) throw new Error(`Remote item missing for ${id}`);
        const expectedHash = blob.manifest.items[id]?.hash;
        if (!expectedHash || hashEncryptedItem(data) !== expectedHash) {
          throw new Error(`Remote item integrity check failed for ${id}`);
        }
        return data;
      },
      5,
      onProgress
        ? (completed, total) => onProgress({ phase: 'downloading', completed, total })
        : undefined,
    );
  } catch (e) {
    mek.fill(0);
    throw e;
  }
  const encryptedItems = results.filter((d): d is Uint8Array => d !== null);

  mek.fill(0); // MEK no longer needed
  return { header, encryptedItems, itemCount: itemIds.length, syncSalt, argon2Params };
}

// ---------------------------------------------------------------------------
// Cloud conflict detection (merged from check-cloud-conflict.ts)
// ---------------------------------------------------------------------------

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
