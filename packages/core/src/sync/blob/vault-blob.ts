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
import { encrypt, decrypt } from '../../crypto/encryption.js';
import { SALT_SIZE } from '../../crypto/constants.js';
import type { Argon2Params } from '../../crypto/constants.js';
import { toBase64 } from '../../utils/base64.js';
import type { SyncManifest } from '../core/types.js';

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

  // Read preamble params for post-decryption verification
  const preamble = readPreambleFromBlob(data);

  const ciphertext = data.slice(PREAMBLE_SIZE);
  const plaintext = decrypt(ciphertext, mek);
  const decoder = new TextDecoder();
  const json = JSON.parse(decoder.decode(plaintext));
  const blob = VaultBlobSchema.parse(json);

  // Verify preamble params match the authenticated inner params to detect preamble tampering
  if (
    blob.argon2Params.t !== preamble.argon2Params.t ||
    blob.argon2Params.m !== preamble.argon2Params.m ||
    blob.argon2Params.p !== preamble.argon2Params.p ||
    blob.argon2Params.dkLen !== preamble.argon2Params.dkLen
  ) {
    throw new Error('Vault blob preamble params do not match authenticated inner params');
  }

  return blob;
}
