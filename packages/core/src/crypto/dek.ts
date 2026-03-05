/**
 * Data Encryption Key (DEK) management — envelope encryption.
 *
 * The DEK is a random 256-bit key that encrypts vault items.
 * It is itself encrypted (wrapped) by a Key Encryption Key (KEK)
 * derived from the master password or recovery key.
 *
 * This two-layer approach means changing the master password only
 * requires re-encrypting the 32-byte DEK, not every vault item.
 */

import { randomBytes } from '@noble/hashes/utils';
import { KEY_SIZE } from './constants.js';
import { encrypt, decrypt } from './encryption.js';

/**
 * Generate a fresh Data Encryption Key (256-bit random).
 *
 * @returns A 32-byte random DEK from a CSPRNG
 */
export function generateDEK(): Uint8Array {
  return randomBytes(KEY_SIZE);
}

/**
 * Wrap (encrypt) a DEK with a KEK using XChaCha20-Poly1305.
 *
 * @param dek - The 32-byte Data Encryption Key to protect
 * @param kek - The 32-byte Key Encryption Key (derived from password)
 * @returns Wrapped DEK (ciphertext with prepended nonce + auth tag)
 * @throws {Error} If dek or kek is not 32 bytes
 */
export function wrapDEK(dek: Uint8Array, kek: Uint8Array): Uint8Array {
  if (dek.length !== KEY_SIZE) {
    throw new Error(`DEK must be ${KEY_SIZE} bytes, got ${dek.length}`);
  }
  return encrypt(dek, kek);
}

/**
 * Unwrap (decrypt) a wrapped DEK with a KEK.
 *
 * @param wrappedDEK - The encrypted DEK (output of wrapDEK)
 * @param kek - The 32-byte Key Encryption Key
 * @returns The original 32-byte DEK
 * @throws {Error} If the KEK is wrong or the wrapped DEK is tampered
 */
export function unwrapDEK(wrappedDEK: Uint8Array, kek: Uint8Array): Uint8Array {
  return decrypt(wrappedDEK, kek);
}
