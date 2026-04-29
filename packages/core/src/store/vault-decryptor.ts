import { decrypt } from '../crypto/encryption.js';
import { VaultItemSchema, type VaultItem } from '../models/vault-item.js';

/**
 * Decrypt a batch of encrypted vault items with the given DEK.
 *
 * Items that fail to decrypt, parse, or validate are **silently skipped**
 * (with a `console.warn`). This is deliberate: a single corrupted ciphertext
 * — whether from a partial sync, disk bit-rot, or a schema drift on a future
 * field — must not brick an otherwise-recoverable vault. The caller receives
 * only the items that round-tripped cleanly.
 *
 * If you need to surface "N items failed" to the UI, that's a deeper change
 * — see CLEANUP.md.
 */
export function decryptItems(dek: Uint8Array, encryptedItems: Uint8Array[]): VaultItem[] {
  const items: VaultItem[] = [];
  for (const encBytes of encryptedItems) {
    try {
      const plainBytes = decrypt(encBytes, dek);
      const json = new TextDecoder().decode(plainBytes);
      const parsed = JSON.parse(json) as unknown;
      items.push(VaultItemSchema.parse(parsed));
    } catch (e) {
      console.warn(
        'Failed to decrypt/parse vault item, skipping:',
        e instanceof Error ? e.message : e,
      );
    }
  }
  return items;
}
