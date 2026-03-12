/**
 * Vault header — lifecycle management for the encrypted vault.
 *
 * The vault header stores everything needed to unlock the vault:
 * - Salts for Argon2id key derivation (master + recovery)
 * - Argon2id parameters (so they can be upgraded)
 * - The DEK wrapped by both master KEK and recovery KEK
 * - A version number for future schema migrations
 *
 * The DEK (Data Encryption Key) is the only key that touches vault items.
 * It is never stored in plaintext — only wrapped by KEKs.
 */

import { randomBytes } from '@noble/hashes/utils';
import type { Argon2Params } from './constants.js';
import { VAULT_VERSION, SALT_SIZE } from './constants.js';
import { deriveKEK } from './kdf.js';
import { generateDEK, wrapDEK, unwrapDEK } from './dek.js';
import { parseRecoveryKey } from './recovery.js';

/** The vault header stored alongside encrypted vault data. */
export type VaultHeader = {
  /** Schema version (starts at 1, for future migrations). */
  version: number;
  /** Salt for master password KDF (16 bytes). */
  masterSalt: Uint8Array;
  /** Salt for recovery key KDF (16 bytes). */
  recoverySalt: Uint8Array;
  /** Argon2id parameters used for key derivation. */
  argon2Params: Argon2Params;
  /** DEK encrypted with master password KEK. */
  masterWrappedDEK: Uint8Array;
  /** DEK encrypted with recovery key KEK. */
  recoveryWrappedDEK: Uint8Array;
};

/** Result of creating a new vault — header + raw DEK for immediate use. */
export type CreateVaultResult = {
  /** The vault header to persist. */
  header: VaultHeader;
  /** The raw DEK — caller must hold in memory only, never persist unencrypted. */
  dek: Uint8Array;
};

/**
 * Create a new vault: generate DEK, derive KEKs, wrap DEK with both.
 *
 * This is called once during initial vault setup.
 * The two KDF derivations run in parallel for ~2x speedup.
 *
 * @param masterPassword - The user's chosen master password
 * @param recoveryKeyRaw - Raw bytes of the recovery key (from generateRecoveryKey().raw)
 * @param params - Argon2id parameters for the platform
 * @returns The vault header and raw DEK
 */
export async function createVaultHeader(
  masterPassword: string,
  recoveryKeyRaw: Uint8Array,
  params: Argon2Params,
): Promise<CreateVaultResult> {
  // Generate distinct salts for master and recovery key derivation
  const masterSalt = randomBytes(SALT_SIZE);
  const recoverySalt = randomBytes(SALT_SIZE);

  // Generate the DEK
  const dek = generateDEK();

  // Derive KEKs in parallel — independent salts, no data dependency
  const recoveryPassword = uint8ArrayToPassword(recoveryKeyRaw);
  const [masterKEK, recoveryKEK] = await Promise.all([
    deriveKEK(masterPassword, masterSalt, params),
    deriveKEK(recoveryPassword, recoverySalt, params),
  ]);

  // Wrap DEK with both KEKs
  const masterWrappedDEK = wrapDEK(dek, masterKEK);
  const recoveryWrappedDEK = wrapDEK(dek, recoveryKEK);

  const header: VaultHeader = {
    version: VAULT_VERSION,
    masterSalt,
    recoverySalt,
    argon2Params: { ...params },
    masterWrappedDEK,
    recoveryWrappedDEK,
  };

  return { header, dek };
}

/**
 * Unlock the vault using the master password.
 *
 * @param header - The persisted vault header
 * @param masterPassword - The user's master password
 * @returns The raw DEK for decrypting vault items
 * @throws {Error} If the password is wrong (auth tag verification fails)
 */
export async function unlockVault(
  header: VaultHeader,
  masterPassword: string,
): Promise<Uint8Array> {
  const masterKEK = await deriveKEK(masterPassword, header.masterSalt, header.argon2Params);
  return unwrapDEK(header.masterWrappedDEK, masterKEK);
}

/**
 * Unlock the vault using a formatted recovery key string.
 *
 * @param header - The persisted vault header
 * @param recoveryKeyFormatted - The formatted recovery key (e.g., "XXXXX-XXXXX-...")
 * @returns The raw DEK for decrypting vault items
 * @throws {Error} If the recovery key is invalid or wrong
 */
export async function unlockVaultWithRecovery(
  header: VaultHeader,
  recoveryKeyFormatted: string,
): Promise<Uint8Array> {
  const recoveryKeyRaw = parseRecoveryKey(recoveryKeyFormatted);
  const recoveryPassword = uint8ArrayToPassword(recoveryKeyRaw);
  const recoveryKEK = await deriveKEK(recoveryPassword, header.recoverySalt, header.argon2Params);
  return unwrapDEK(header.recoveryWrappedDEK, recoveryKEK);
}

/**
 * Change the master password: re-wrap the existing DEK with a new KEK.
 *
 * Optionally upgrades Argon2id parameters (e.g., when migrating to a more
 * powerful device). The recovery key wrapping is preserved unchanged.
 *
 * @param header - The current vault header
 * @param currentDEK - The currently unlocked raw DEK
 * @param newPassword - The new master password
 * @param newParams - Optional new Argon2id parameters (defaults to current)
 * @returns Updated vault header with new master wrapping
 */
export async function changeMasterPassword(
  header: VaultHeader,
  currentDEK: Uint8Array,
  newPassword: string,
  newParams?: Argon2Params,
): Promise<VaultHeader> {
  const params = newParams ?? header.argon2Params;
  const newMasterSalt = randomBytes(SALT_SIZE);
  const newMasterKEK = await deriveKEK(newPassword, newMasterSalt, params);
  const newMasterWrappedDEK = wrapDEK(currentDEK, newMasterKEK);

  return {
    ...header,
    masterSalt: newMasterSalt,
    argon2Params: { ...params },
    masterWrappedDEK: newMasterWrappedDEK,
  };
}

/**
 * Serialize a VaultHeader to a deterministic binary format for storage.
 *
 * Format (v1):
 * [1B version]
 * [16B masterSalt]
 * [16B recoverySalt]
 * [4B argon2.t LE][4B argon2.m LE][4B argon2.p LE][4B argon2.dkLen LE]
 * [2B masterWrappedDEK.length LE][...masterWrappedDEK]
 * [2B recoveryWrappedDEK.length LE][...recoveryWrappedDEK]
 */
export function serializeVaultHeader(header: VaultHeader): Uint8Array {
  const masterLen = header.masterWrappedDEK.length;
  const recoveryLen = header.recoveryWrappedDEK.length;

  // 1 + 16 + 16 + 16 + 2 + masterLen + 2 + recoveryLen
  const totalSize = 1 + SALT_SIZE + SALT_SIZE + 16 + 2 + masterLen + 2 + recoveryLen;
  const buffer = new Uint8Array(totalSize);
  const view = new DataView(buffer.buffer);
  let offset = 0;

  // Version
  buffer[offset] = header.version;
  offset += 1;

  // Salts
  buffer.set(header.masterSalt, offset);
  offset += SALT_SIZE;
  buffer.set(header.recoverySalt, offset);
  offset += SALT_SIZE;

  // Argon2 params (4 x uint32 LE)
  view.setUint32(offset, header.argon2Params.t, true);
  offset += 4;
  view.setUint32(offset, header.argon2Params.m, true);
  offset += 4;
  view.setUint32(offset, header.argon2Params.p, true);
  offset += 4;
  view.setUint32(offset, header.argon2Params.dkLen, true);
  offset += 4;

  // masterWrappedDEK (length-prefixed)
  view.setUint16(offset, masterLen, true);
  offset += 2;
  buffer.set(header.masterWrappedDEK, offset);
  offset += masterLen;

  // recoveryWrappedDEK (length-prefixed)
  view.setUint16(offset, recoveryLen, true);
  offset += 2;
  buffer.set(header.recoveryWrappedDEK, offset);

  return buffer;
}

/**
 * Deserialize a binary vault header back to a VaultHeader object.
 *
 * @throws {Error} If the binary data is malformed or version is unsupported
 */
export function deserializeVaultHeader(bytes: Uint8Array): VaultHeader {
  if (bytes.length < 1) {
    throw new Error('Vault header is empty');
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0;

  // Version
  const version = bytes[offset]!;
  offset += 1;

  if (version !== VAULT_VERSION) {
    throw new Error(`Unsupported vault version: ${version}, expected ${VAULT_VERSION}`);
  }

  // Minimum size for fixed fields: 1 (version) + 16 (masterSalt) + 16 (recoverySalt) + 16 (argon2 params) = 49
  if (bytes.length < 49) {
    throw new Error('Vault header too short');
  }

  // Salts
  const masterSalt = bytes.slice(offset, offset + SALT_SIZE);
  offset += SALT_SIZE;
  const recoverySalt = bytes.slice(offset, offset + SALT_SIZE);
  offset += SALT_SIZE;

  // Argon2 params
  const t = view.getUint32(offset, true);
  offset += 4;
  const m = view.getUint32(offset, true);
  offset += 4;
  const p = view.getUint32(offset, true);
  offset += 4;
  const dkLen = view.getUint32(offset, true);
  offset += 4;

  // masterWrappedDEK
  if (offset + 2 > bytes.length) {
    throw new Error('Vault header truncated at masterWrappedDEK length');
  }
  const masterLen = view.getUint16(offset, true);
  offset += 2;
  if (offset + masterLen > bytes.length) {
    throw new Error('Vault header truncated at masterWrappedDEK data');
  }
  const masterWrappedDEK = bytes.slice(offset, offset + masterLen);
  offset += masterLen;

  // recoveryWrappedDEK
  if (offset + 2 > bytes.length) {
    throw new Error('Vault header truncated at recoveryWrappedDEK length');
  }
  const recoveryLen = view.getUint16(offset, true);
  offset += 2;
  if (offset + recoveryLen > bytes.length) {
    throw new Error('Vault header truncated at recoveryWrappedDEK data');
  }
  const recoveryWrappedDEK = bytes.slice(offset, offset + recoveryLen);

  return {
    version,
    masterSalt,
    recoverySalt,
    argon2Params: { t, m, p, dkLen },
    masterWrappedDEK,
    recoveryWrappedDEK,
  };
}

/**
 * Convert a Uint8Array to a string suitable for use as an Argon2id "password".
 *
 * Uses hex encoding so every byte is representable. This is internal —
 * the recovery key raw bytes effectively become the password input to Argon2id.
 */
function uint8ArrayToPassword(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
