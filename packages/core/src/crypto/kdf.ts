/**
 * Key Derivation Function — Argon2id.
 *
 * Derives a Key Encryption Key (KEK) from a master password and salt.
 * Uses the @noble/hashes implementation which is audited and pure TypeScript.
 *
 * @see https://www.rfc-editor.org/rfc/rfc9106 — Argon2 specification
 */

import { argon2id } from '@noble/hashes/argon2';
import type { Argon2Params } from './constants.js';
import { KEY_SIZE, SALT_SIZE } from './constants.js';

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
export function deriveKEK(password: string, salt: Uint8Array, params: Argon2Params): Uint8Array {
  if (salt.length !== SALT_SIZE) {
    throw new Error(`Salt must be ${SALT_SIZE} bytes, got ${salt.length}`);
  }
  if (params.dkLen !== KEY_SIZE) {
    throw new Error(`dkLen must be ${KEY_SIZE}, got ${params.dkLen}`);
  }

  const encoder = new TextEncoder();
  const passwordBytes = encoder.encode(password);

  try {
    return argon2id(passwordBytes, salt, {
      t: params.t,
      m: params.m,
      p: params.p,
      dkLen: params.dkLen,
    });
  } finally {
    // Zero out password bytes from memory
    passwordBytes.fill(0);
  }
}
