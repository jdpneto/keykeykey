/**
 * PIN-based DEK wrapping for the browser extension.
 *
 * Allows a short PIN to protect the Data Encryption Key (DEK) in the browser
 * extension's local storage. The PIN is stretched via Argon2id to produce a
 * Key Encryption Key (KEK), which is then used to wrap/unwrap the DEK with
 * XChaCha20-Poly1305.
 *
 * Security note: A PIN has lower entropy than a master password. This is an
 * intentional UX trade-off for the extension's quick-unlock flow. The Argon2id
 * browser preset (t:2, m:19456) adds cost to brute-force attempts.
 */

import { deriveKEK, encrypt, decrypt, ARGON2_PRESETS, SALT_SIZE } from '@keykeykey/core/crypto';

/**
 * Wrap a DEK with a PIN using Argon2id + XChaCha20-Poly1305.
 *
 * @param dek - The 32-byte Data Encryption Key to protect.
 * @param pin - The user's PIN (UTF-8 string).
 * @returns The wrapped DEK ciphertext and the random salt used for KDF.
 */
export async function wrapDekWithPin(
  dek: Uint8Array,
  pin: string,
): Promise<{ wrappedDek: Uint8Array; salt: Uint8Array }> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_SIZE));
  const kek = await deriveKEK(pin, salt, ARGON2_PRESETS.browser);
  const wrappedDek = encrypt(dek, kek);
  return { wrappedDek, salt };
}

/**
 * Unwrap a DEK that was wrapped with a PIN.
 *
 * @param wrappedDek - The ciphertext produced by `wrapDekWithPin`.
 * @param salt - The KDF salt stored alongside the wrapped DEK.
 * @param pin - The user's PIN (UTF-8 string).
 * @returns The recovered 32-byte DEK.
 * @throws {Error} If decryption fails (wrong PIN or corrupted data).
 */
export async function unwrapDekWithPin(
  wrappedDek: Uint8Array,
  salt: Uint8Array,
  pin: string,
): Promise<Uint8Array> {
  const kek = await deriveKEK(pin, salt, ARGON2_PRESETS.browser);
  return decrypt(wrappedDek, kek);
}
