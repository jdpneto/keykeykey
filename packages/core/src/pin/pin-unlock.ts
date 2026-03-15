/**
 * PIN-based DEK wrapping for quick unlock.
 *
 * Extracts the PIN→KEK→DEK wrapping pattern from the browser extension
 * into a shared, platform-agnostic module.
 *
 * The PIN is stretched via Argon2id to produce a KEK, which wraps the DEK
 * with XChaCha20-Poly1305. Attempt tracking and storage are the caller's
 * responsibility.
 *
 * Security: PINs have low entropy (4-8 digits). The Argon2id cost and
 * platform-side attempt lockout (MAX_PIN_ATTEMPTS) provide brute-force
 * protection.
 */

import { deriveKEK, encrypt, decrypt, ARGON2_PRESETS, SALT_SIZE } from '../crypto/index.js';
import { validatePin } from './pin-validation.js';

/** PIN data stored by the platform's storage layer. */
export interface PinData {
  /** DEK encrypted with PIN-derived KEK (XChaCha20-Poly1305 ciphertext). */
  wrappedDEK: Uint8Array;
  /** Random salt used for the Argon2id KDF. */
  salt: Uint8Array;
}

/** Maximum PIN attempts before lockout. Exported for callers to use. */
export const MAX_PIN_ATTEMPTS = 5;

/**
 * Set up PIN-based quick unlock by wrapping the DEK.
 *
 * @param pin - The user's chosen PIN (must pass validatePin).
 * @param dek - The 32-byte DEK to protect. Not zeroed by this function.
 * @returns PinData containing the wrapped DEK and KDF salt.
 */
export async function setupPin(pin: string, dek: Uint8Array): Promise<PinData> {
  const validation = validatePin(pin);
  if (!validation.valid) {
    throw new Error(`Invalid PIN: ${validation.error}`);
  }
  const salt = crypto.getRandomValues(new Uint8Array(SALT_SIZE));
  const kek = await deriveKEK(pin, salt, ARGON2_PRESETS.pin);
  const wrappedDEK = encrypt(dek, kek);
  return { wrappedDEK, salt };
}

/**
 * Attempt to unwrap a DEK using a PIN.
 *
 * @param pin - The PIN to try.
 * @param pinData - The stored PinData from setupPin.
 * @returns The 32-byte DEK on success, or null if the PIN is wrong.
 */
export async function unwrapDekWithPin(
  pin: string,
  pinData: PinData,
): Promise<Uint8Array | null> {
  try {
    const kek = await deriveKEK(pin, pinData.salt, ARGON2_PRESETS.pin);
    return decrypt(pinData.wrappedDEK, kek);
  } catch {
    // Decryption failure = wrong PIN (auth tag mismatch)
    return null;
  }
}
