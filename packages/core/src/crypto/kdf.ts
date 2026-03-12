/**
 * Key Derivation Function — Argon2id.
 *
 * Derives a Key Encryption Key (KEK) from a master password and salt.
 * Uses the platform-pluggable Argon2Adapter so native implementations
 * can be injected on mobile/desktop for dramatically better performance.
 *
 * @see https://www.rfc-editor.org/rfc/rfc9106 — Argon2 specification
 */

import type { Argon2Params } from './constants.js';
import { KEY_SIZE, SALT_SIZE } from './constants.js';
import { getArgon2Adapter } from './argon2-adapter.js';

/**
 * Derive a KEK from a master password using Argon2id.
 *
 * @param password - The user's master password (UTF-8 string)
 * @param salt - A 16-byte random salt (must be stored in vault header)
 * @param params - Argon2id tuning parameters (t, m, p, dkLen)
 * @returns A 32-byte derived key (KEK)
 * @throws {Error} If salt length is not SALT_SIZE (16 bytes)
 * @throws {Error} If dkLen is not KEY_SIZE (32 bytes)
 */
export async function deriveKEK(
  password: string,
  salt: Uint8Array,
  params: Argon2Params,
): Promise<Uint8Array> {
  if (salt.length !== SALT_SIZE) {
    throw new Error(`Salt must be ${SALT_SIZE} bytes, got ${salt.length}`);
  }
  if (params.dkLen !== KEY_SIZE) {
    throw new Error(`dkLen must be ${KEY_SIZE}, got ${params.dkLen}`);
  }

  const encoder = new TextEncoder();
  const passwordBytes = encoder.encode(password);

  try {
    const adapter = getArgon2Adapter();
    return await adapter.hash(passwordBytes, salt, params);
  } finally {
    // Zero out password bytes from memory
    passwordBytes.fill(0);
  }
}
