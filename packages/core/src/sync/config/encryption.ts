import { encrypt, decrypt } from '../../crypto/encryption.js';
import { SyncConfigSchema } from './schema.js';
import type { SyncConfig } from './schema.js';

/**
 * Encrypt a SyncConfig for persistent storage using XChaCha20-Poly1305.
 *
 * The config is JSON-serialized then encrypted with the provided DEK.
 * A random 24-byte nonce is prepended to the output, so encrypting the same
 * config twice produces different ciphertext.
 *
 * @param config - The sync configuration to encrypt
 * @param dek - 32-byte data encryption key
 * @returns Encrypted bytes: [24B nonce][ciphertext][16B Poly1305 tag]
 */
export function encryptSyncConfig(config: SyncConfig, dek: Uint8Array): Uint8Array {
  const json = JSON.stringify(config);
  return encrypt(new TextEncoder().encode(json), dek);
}

/**
 * Decrypt a SyncConfig previously encrypted with {@link encryptSyncConfig}.
 *
 * @param data - Encrypted bytes produced by encryptSyncConfig
 * @param dek - 32-byte data encryption key (must match the encryption key)
 * @returns The decrypted SyncConfig
 * @throws {Error} If the ciphertext is tampered or the wrong key is used
 */
export function decryptSyncConfig(data: Uint8Array, dek: Uint8Array): SyncConfig {
  const plainBytes = decrypt(data, dek);
  const parsed: unknown = JSON.parse(new TextDecoder().decode(plainBytes));
  return SyncConfigSchema.parse(parsed);
}
