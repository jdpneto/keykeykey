/**
 * Symmetric encryption primitives — XChaCha20-Poly1305 with managed nonce.
 *
 * Uses @noble/ciphers' `managedNonce` wrapper which:
 * - Generates a random 24-byte nonce per encryption
 * - Prepends the nonce to the ciphertext
 * - Strips the nonce on decryption
 *
 * Output format: [24-byte nonce][ciphertext][16-byte Poly1305 tag]
 *
 * @see https://www.rfc-editor.org/rfc/rfc7539 — ChaCha20-Poly1305
 * @see https://datatracker.ietf.org/doc/html/draft-irtf-cfrg-xchacha — XChaCha20
 */

import { xchacha20poly1305 } from '@noble/ciphers/chacha';
import { managedNonce } from '@noble/ciphers/webcrypto';
import { KEY_SIZE } from './constants.js';

/**
 * Encrypt plaintext with XChaCha20-Poly1305 (managed nonce).
 *
 * @param plaintext - Data to encrypt (may be empty)
 * @param key - 32-byte symmetric key
 * @returns Ciphertext with prepended nonce: [24B nonce][ciphertext][16B tag]
 * @throws {Error} If key length is not 32 bytes
 */
export function encrypt(plaintext: Uint8Array, key: Uint8Array): Uint8Array {
  if (key.length !== KEY_SIZE) {
    throw new Error(`Key must be ${KEY_SIZE} bytes, got ${key.length}`);
  }

  const cipher = managedNonce(xchacha20poly1305)(key);
  return cipher.encrypt(plaintext);
}

/**
 * Decrypt ciphertext encrypted with XChaCha20-Poly1305 (managed nonce).
 *
 * @param ciphertext - Data to decrypt: [24B nonce][ciphertext][16B tag]
 * @param key - 32-byte symmetric key (must match the encryption key)
 * @returns Decrypted plaintext
 * @throws {Error} If key length is not 32 bytes
 * @throws {Error} If ciphertext is tampered or wrong key is used (auth tag verification fails)
 */
export function decrypt(ciphertext: Uint8Array, key: Uint8Array): Uint8Array {
  if (key.length !== KEY_SIZE) {
    throw new Error(`Key must be ${KEY_SIZE} bytes, got ${key.length}`);
  }

  const cipher = managedNonce(xchacha20poly1305)(key);
  return cipher.decrypt(ciphertext);
}
