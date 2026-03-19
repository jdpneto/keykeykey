/**
 * Vault blob encryption for sync — encrypts the entire vault (manifest + header)
 * into a single encrypted blob with a 32-byte preamble containing the sync salt
 * and Argon2id parameters.
 *
 * Wire format: [16-byte salt][16-byte params (4×uint32 LE)][XChaCha20-Poly1305 ciphertext]
 *
 * The plaintext inside the ciphertext is a JSON-encoded VaultBlob object.
 */

import { z } from 'zod';
import { randomBytes } from '@noble/hashes/utils';
import { encrypt, decrypt } from '../crypto/encryption.js';
import { deriveKEK } from '../crypto/kdf.js';
import { SALT_SIZE, KEY_SIZE } from '../crypto/constants.js';
import type { Argon2Params } from '../crypto/constants.js';
import { toBase64 } from '../utils/base64.js';
import type { SyncManifest } from './types.js';

/** Size of the preamble prepended to encrypted vault blobs: 16 (salt) + 16 (params). */
export const PREAMBLE_SIZE = 32;

// ---------------------------------------------------------------------------
// Zod schema
// ---------------------------------------------------------------------------

const Argon2ParamsSchema = z.object({
  t: z.number(),
  m: z.number(),
  p: z.number(),
  dkLen: z.number(),
});

const SyncItemMetaSchema = z.object({
  updatedAt: z.string(),
  hash: z.string(),
});

const TombstoneEntrySchema = z.object({
  deletedAt: z.string(),
});

const SyncManifestSchema = z.object({
  version: z.number(),
  lastModified: z.string(),
  items: z.record(z.string(), SyncItemMetaSchema),
  tombstones: z.record(z.string(), TombstoneEntrySchema).optional(),
  vaultId: z.string().optional(),
});

/** Zod schema for the decrypted VaultBlob JSON payload. */
export const VaultBlobSchema = z.object({
  version: z.literal(1),
  argon2Params: Argon2ParamsSchema,
  vaultHeader: z.string(), // base64-encoded vault header bytes
  manifest: SyncManifestSchema,
});

export type VaultBlob = z.infer<typeof VaultBlobSchema>;

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

// ---------------------------------------------------------------------------
// Preamble helpers
// ---------------------------------------------------------------------------

function buildPreamble(syncSalt: Uint8Array, params: Argon2Params): Uint8Array {
  const preamble = new Uint8Array(PREAMBLE_SIZE);
  preamble.set(syncSalt, 0);
  const view = new DataView(preamble.buffer, preamble.byteOffset, preamble.byteLength);
  view.setUint32(16, params.t, true);
  view.setUint32(20, params.m, true);
  view.setUint32(24, params.p, true);
  view.setUint32(28, params.dkLen, true);
  return preamble;
}

/**
 * Extract the sync salt and Argon2id parameters from the first 32 bytes of a vault blob.
 *
 * @throws {Error} If data is shorter than PREAMBLE_SIZE.
 */
export function readPreambleFromBlob(data: Uint8Array): {
  syncSalt: Uint8Array;
  argon2Params: Argon2Params;
} {
  if (data.length < PREAMBLE_SIZE) {
    throw new Error(
      `Vault blob too short: expected at least ${PREAMBLE_SIZE} bytes, got ${data.length}`,
    );
  }

  const syncSalt = data.slice(0, SALT_SIZE);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const argon2Params: Argon2Params = {
    t: view.getUint32(16, true),
    m: view.getUint32(20, true),
    p: view.getUint32(24, true),
    dkLen: view.getUint32(28, true),
  };

  return { syncSalt, argon2Params };
}

// ---------------------------------------------------------------------------
// Encrypt / Decrypt
// ---------------------------------------------------------------------------

/**
 * Encrypt a vault blob (manifest + vault header) with XChaCha20-Poly1305.
 *
 * @returns Uint8Array: [32-byte preamble][ciphertext]
 */
export function encryptVaultBlob(
  manifest: SyncManifest,
  vaultHeader: Uint8Array,
  mek: Uint8Array,
  syncSalt: Uint8Array,
  argon2Params: Argon2Params,
): Uint8Array {
  const blob: VaultBlob = {
    version: 1,
    argon2Params,
    vaultHeader: toBase64(vaultHeader),
    manifest,
  };

  const encoder = new TextEncoder();
  const plaintext = encoder.encode(JSON.stringify(blob));
  const ciphertext = encrypt(plaintext, mek);

  const preamble = buildPreamble(syncSalt, argon2Params);
  const result = new Uint8Array(PREAMBLE_SIZE + ciphertext.length);
  result.set(preamble, 0);
  result.set(ciphertext, PREAMBLE_SIZE);
  return result;
}

/**
 * Decrypt a vault blob, stripping the preamble and Zod-validating the payload.
 *
 * @throws {Error} If decryption fails (wrong key or tampered data).
 * @throws {z.ZodError} If the decrypted JSON does not match VaultBlobSchema.
 */
export function decryptVaultBlob(data: Uint8Array, mek: Uint8Array): VaultBlob {
  if (data.length < PREAMBLE_SIZE) {
    throw new Error(
      `Vault blob too short: expected at least ${PREAMBLE_SIZE} bytes, got ${data.length}`,
    );
  }

  const ciphertext = data.slice(PREAMBLE_SIZE);
  const plaintext = decrypt(ciphertext, mek);
  const decoder = new TextDecoder();
  const json = JSON.parse(decoder.decode(plaintext));
  return VaultBlobSchema.parse(json);
}
