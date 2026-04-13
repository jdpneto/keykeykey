/**
 * Encrypted vault backup import.
 *
 * Reads the wire format produced by encrypted-export.ts:
 * [16-byte salt][16-byte Argon2 params][XChaCha20-Poly1305 ciphertext of ZIP]
 */

import { unzipSync } from 'fflate';
import { decrypt } from '../crypto/encryption.js';
import { deriveKEK } from '../crypto/kdf.js';
import type { Argon2Params } from '../crypto/constants.js';
import { BACKUP_PREAMBLE_SIZE } from './encrypted-export.js';
import { validateArgon2Params } from '../sync/blob/mek.js';

/**
 * Decrypt and extract vault files from an encrypted backup.
 *
 * @param fileBytes - The encrypted backup file bytes
 * @param zipPassword - The password used to encrypt the backup
 * @returns Map of relative path → file bytes
 * @throws {Error} If the password is wrong or the data is corrupt
 */
export async function importEncryptedBackup(
  fileBytes: Uint8Array,
  zipPassword: string,
): Promise<Map<string, Uint8Array>> {
  if (fileBytes.length < BACKUP_PREAMBLE_SIZE) {
    throw new Error(
      `Backup file too short: expected at least ${BACKUP_PREAMBLE_SIZE} bytes, got ${fileBytes.length}`,
    );
  }

  // 1. Read preamble
  const salt = fileBytes.slice(0, 16);
  const view = new DataView(fileBytes.buffer, fileBytes.byteOffset, fileBytes.byteLength);
  const params: Argon2Params = {
    t: view.getUint32(16, true),
    m: view.getUint32(20, true),
    p: view.getUint32(24, true),
    dkLen: view.getUint32(28, true),
  };

  // 2. Validate Argon2 params before doing expensive KDF work
  validateArgon2Params(params);

  // 3. Derive key
  const key = await deriveKEK(zipPassword, salt, params);

  // 4. Decrypt
  const ciphertext = fileBytes.slice(BACKUP_PREAMBLE_SIZE);
  const zipBytes = decrypt(ciphertext, key);

  // 5. Unzip
  const files = unzipSync(zipBytes);

  // 6. Convert to Map
  const result = new Map<string, Uint8Array>();
  for (const [path, data] of Object.entries(files)) {
    result.set(path, data);
  }

  return result;
}
