/**
 * Cryptographic primitives for KeyKeyKey vault encryption.
 *
 * Uses @noble/ciphers (XChaCha20-Poly1305) and @noble/hashes (Argon2id).
 *
 * Encryption flow:
 * 1. Derive KEK from MasterPassword via Argon2id
 * 2. Generate random DEK (Data Encryption Key)
 * 3. Wrap DEK with KEK (envelope encryption)
 * 4. Encrypt vault items with DEK using XChaCha20-Poly1305
 *
 * @module crypto
 */

// Constants & types
export {
  ARGON2_PRESETS,
  KEY_SIZE,
  SALT_SIZE,
  NONCE_SIZE,
  TAG_SIZE,
  MANAGED_NONCE_OVERHEAD,
  VAULT_VERSION,
  RECOVERY_KEY_BYTES,
} from './constants.js';
export type { Argon2Params, Argon2Preset } from './constants.js';

// Key derivation
export { deriveKEK } from './kdf.js';

// Symmetric encryption
export { encrypt, decrypt } from './encryption.js';

// Envelope encryption (DEK management)
export { generateDEK, wrapDEK, unwrapDEK } from './dek.js';

// Recovery key
export { generateRecoveryKey, parseRecoveryKey } from './recovery.js';
export type { RecoveryKeyResult } from './recovery.js';

// Vault header lifecycle
export {
  createVaultHeader,
  unlockVault,
  unlockVaultWithRecovery,
  changeMasterPassword,
  serializeVaultHeader,
  deserializeVaultHeader,
} from './vault-header.js';
export type { VaultHeader, CreateVaultResult } from './vault-header.js';
