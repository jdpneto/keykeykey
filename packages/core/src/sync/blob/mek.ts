/**
 * Sync MEK (Manifest Encryption Key) derivation and related utilities.
 */

import { randomBytes } from '@noble/hashes/utils';
import { deriveKEK } from '../../crypto/kdf.js';
import { SALT_SIZE, KEY_SIZE } from '../../crypto/constants.js';
import type { Argon2Params } from '../../crypto/constants.js';

// ---------------------------------------------------------------------------
// Salt generation
// ---------------------------------------------------------------------------

/** Generate a random 16-byte sync salt. */
export function generateSyncSalt(): Uint8Array {
  return randomBytes(SALT_SIZE);
}

// ---------------------------------------------------------------------------
// MEK derivation
// ---------------------------------------------------------------------------

/**
 * Derive a 32-byte Manifest Encryption Key from the master password and sync salt.
 * Delegates to the existing `deriveKEK` (Argon2id).
 */
export async function deriveMEK(
  masterPassword: string,
  syncSalt: Uint8Array,
  params: Argon2Params,
): Promise<Uint8Array> {
  return deriveKEK(masterPassword, syncSalt, params);
}

// ---------------------------------------------------------------------------
// Param validation
// ---------------------------------------------------------------------------

/**
 * Validate Argon2id parameters are within acceptable bounds.
 *
 * @throws {Error} If any parameter is out of bounds.
 */
export function validateArgon2Params(params: Argon2Params): void {
  if (params.t < 1 || params.t > 10) {
    throw new Error(`Argon2 t (iterations) must be 1-10, got ${params.t}`);
  }
  if (params.m < 8192 || params.m > 262144) {
    throw new Error(`Argon2 m (memory KiB) must be 8192-262144, got ${params.m}`);
  }
  if (params.p < 1 || params.p > 16) {
    throw new Error(`Argon2 p (parallelism) must be 1-16, got ${params.p}`);
  }
  if (params.dkLen !== KEY_SIZE) {
    throw new Error(`Argon2 dkLen must be ${KEY_SIZE}, got ${params.dkLen}`);
  }
}
