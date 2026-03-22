/**
 * Encrypted vault backup export.
 *
 * Wire format: [16-byte salt][16-byte Argon2 params (4×uint32 LE)][XChaCha20-Poly1305 ciphertext of ZIP]
 *
 * The ZIP contains the same vault directory structure used by sync:
 * vault.enc + items/{uuid}
 */

import { zipSync } from 'fflate';
import { randomBytes } from '@noble/hashes/utils';
import { encrypt } from '../crypto/encryption.js';
import { deriveKEK } from '../crypto/kdf.js';
import { SALT_SIZE } from '../crypto/constants.js';
import type { Argon2Params } from '../crypto/constants.js';

/** Backup argon2 params — lighter than vault to keep UX snappy. */
const BACKUP_ARGON2_PARAMS: Argon2Params = { t: 2, m: 19_456, p: 1, dkLen: 32 };

/** Size of the preamble: 16 (salt) + 16 (4 × uint32 params). */
export const BACKUP_PREAMBLE_SIZE = 32;

/**
 * Export vault files into an encrypted backup.
 *
 * @param vaultFiles - Map of relative path → file bytes (e.g., "vault.enc", "items/uuid")
 * @param zipPassword - Password to encrypt the backup with
 * @returns Encrypted backup bytes: [salt][params][ciphertext]
 */
export async function exportEncryptedBackup(
  vaultFiles: Map<string, Uint8Array>,
  zipPassword: string,
): Promise<Uint8Array> {
  // 1. Create ZIP from vault files
  const zipInput: Record<string, Uint8Array> = {};
  for (const [path, data] of vaultFiles) {
    zipInput[path] = data;
  }
  const zipBytes = zipSync(zipInput, { level: 0 });

  // 2. Derive encryption key from zip password
  const salt = randomBytes(SALT_SIZE);
  const key = await deriveKEK(zipPassword, salt, BACKUP_ARGON2_PARAMS);

  // 3. Encrypt the ZIP
  const ciphertext = encrypt(zipBytes, key);

  // 4. Build preamble
  const preamble = new Uint8Array(BACKUP_PREAMBLE_SIZE);
  preamble.set(salt, 0);
  const view = new DataView(preamble.buffer, preamble.byteOffset, preamble.byteLength);
  view.setUint32(16, BACKUP_ARGON2_PARAMS.t, true);
  view.setUint32(20, BACKUP_ARGON2_PARAMS.m, true);
  view.setUint32(24, BACKUP_ARGON2_PARAMS.p, true);
  view.setUint32(28, BACKUP_ARGON2_PARAMS.dkLen, true);

  // 5. Concatenate: preamble + ciphertext
  const result = new Uint8Array(BACKUP_PREAMBLE_SIZE + ciphertext.length);
  result.set(preamble, 0);
  result.set(ciphertext, BACKUP_PREAMBLE_SIZE);

  return result;
}
