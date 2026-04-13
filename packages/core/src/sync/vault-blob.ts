export { PREAMBLE_SIZE, encryptVaultBlob, decryptVaultBlob, readPreambleFromBlob, VaultBlobSchema } from './blob/vault-blob.js';
export type { VaultBlob } from './blob/vault-blob.js';
export { generateSyncSalt, deriveMEK, validateArgon2Params } from './blob/mek.js';
