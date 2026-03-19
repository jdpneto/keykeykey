import { describe, it, expect } from 'vitest';
import { randomBytes } from '@noble/hashes/utils';
import { encrypt } from '../crypto/encryption.js';
import { toBase64 } from '../utils/base64.js';
import type { Argon2Params } from '../crypto/constants.js';
import type { SyncManifest } from './types.js';
import {
  PREAMBLE_SIZE,
  generateSyncSalt,
  deriveMEK,
  validateArgon2Params,
  encryptVaultBlob,
  decryptVaultBlob,
  readPreambleFromBlob,
  VaultBlobSchema,
} from './vault-blob.js';

const TEST_PARAMS: Argon2Params = { t: 1, m: 8192, p: 1, dkLen: 32 };
const TEST_PASSWORD = 'test-master-password';

function makeManifest(): SyncManifest {
  return {
    version: 2,
    lastModified: new Date().toISOString(),
    items: {
      'item-1': { updatedAt: new Date().toISOString(), hash: 'abc123' },
    },
    tombstones: {
      'item-2': { deletedAt: new Date().toISOString() },
    },
    vaultId: 'vault-123',
  };
}

describe('vault-blob', () => {
  describe('PREAMBLE_SIZE', () => {
    it('is 32', () => {
      expect(PREAMBLE_SIZE).toBe(32);
    });
  });

  describe('generateSyncSalt', () => {
    it('returns 16 bytes', () => {
      const salt = generateSyncSalt();
      expect(salt).toBeInstanceOf(Uint8Array);
      expect(salt.length).toBe(16);
    });

    it('returns unique values each call', () => {
      const a = generateSyncSalt();
      const b = generateSyncSalt();
      expect(a).not.toEqual(b);
    });
  });

  describe('deriveMEK', () => {
    it('returns 32 bytes', async () => {
      const salt = generateSyncSalt();
      const mek = await deriveMEK(TEST_PASSWORD, salt, TEST_PARAMS);
      expect(mek).toBeInstanceOf(Uint8Array);
      expect(mek.length).toBe(32);
    });

    it('is deterministic for same inputs', async () => {
      const salt = generateSyncSalt();
      const a = await deriveMEK(TEST_PASSWORD, salt, TEST_PARAMS);
      const b = await deriveMEK(TEST_PASSWORD, salt, TEST_PARAMS);
      expect(a).toEqual(b);
    });

    it('differs for different passwords', async () => {
      const salt = generateSyncSalt();
      const a = await deriveMEK('password-a', salt, TEST_PARAMS);
      const b = await deriveMEK('password-b', salt, TEST_PARAMS);
      expect(a).not.toEqual(b);
    });

    it('differs for different salts', async () => {
      const saltA = generateSyncSalt();
      const saltB = generateSyncSalt();
      const a = await deriveMEK(TEST_PASSWORD, saltA, TEST_PARAMS);
      const b = await deriveMEK(TEST_PASSWORD, saltB, TEST_PARAMS);
      expect(a).not.toEqual(b);
    });
  });

  describe('validateArgon2Params', () => {
    it('accepts valid params', () => {
      expect(() => validateArgon2Params(TEST_PARAMS)).not.toThrow();
      expect(() => validateArgon2Params({ t: 10, m: 262144, p: 16, dkLen: 32 })).not.toThrow();
    });

    it('rejects t out of bounds', () => {
      expect(() => validateArgon2Params({ ...TEST_PARAMS, t: 0 })).toThrow();
      expect(() => validateArgon2Params({ ...TEST_PARAMS, t: 11 })).toThrow();
    });

    it('rejects m out of bounds', () => {
      expect(() => validateArgon2Params({ ...TEST_PARAMS, m: 8191 })).toThrow();
      expect(() => validateArgon2Params({ ...TEST_PARAMS, m: 262145 })).toThrow();
    });

    it('rejects p out of bounds', () => {
      expect(() => validateArgon2Params({ ...TEST_PARAMS, p: 0 })).toThrow();
      expect(() => validateArgon2Params({ ...TEST_PARAMS, p: 17 })).toThrow();
    });

    it('rejects dkLen !== 32', () => {
      expect(() => validateArgon2Params({ ...TEST_PARAMS, dkLen: 16 })).toThrow();
      expect(() => validateArgon2Params({ ...TEST_PARAMS, dkLen: 64 })).toThrow();
    });
  });

  describe('encryptVaultBlob / decryptVaultBlob round-trip', () => {
    it('round-trips successfully', async () => {
      const salt = generateSyncSalt();
      const mek = await deriveMEK(TEST_PASSWORD, salt, TEST_PARAMS);
      const manifest = makeManifest();
      const vaultHeader = randomBytes(64);

      const encrypted = encryptVaultBlob(manifest, vaultHeader, mek, salt, TEST_PARAMS);
      expect(encrypted).toBeInstanceOf(Uint8Array);
      expect(encrypted.length).toBeGreaterThan(PREAMBLE_SIZE);

      const decrypted = decryptVaultBlob(encrypted, mek);
      expect(decrypted.manifest).toEqual(manifest);
      expect(decrypted.vaultHeader).toEqual(toBase64(vaultHeader));
      expect(decrypted.version).toBe(1);
      expect(decrypted.argon2Params).toEqual(TEST_PARAMS);
    });

    it('produces different ciphertext each call (random nonce)', async () => {
      const salt = generateSyncSalt();
      const mek = await deriveMEK(TEST_PASSWORD, salt, TEST_PARAMS);
      const manifest = makeManifest();
      const vaultHeader = randomBytes(64);

      const a = encryptVaultBlob(manifest, vaultHeader, mek, salt, TEST_PARAMS);
      const b = encryptVaultBlob(manifest, vaultHeader, mek, salt, TEST_PARAMS);
      expect(a).not.toEqual(b);
    });

    it('throws on wrong MEK', async () => {
      const salt = generateSyncSalt();
      const mek = await deriveMEK(TEST_PASSWORD, salt, TEST_PARAMS);
      const wrongMek = randomBytes(32);
      const manifest = makeManifest();
      const vaultHeader = randomBytes(64);

      const encrypted = encryptVaultBlob(manifest, vaultHeader, mek, salt, TEST_PARAMS);
      expect(() => decryptVaultBlob(encrypted, wrongMek)).toThrow();
    });

    it('throws on tampered data', async () => {
      const salt = generateSyncSalt();
      const mek = await deriveMEK(TEST_PASSWORD, salt, TEST_PARAMS);
      const manifest = makeManifest();
      const vaultHeader = randomBytes(64);

      const encrypted = encryptVaultBlob(manifest, vaultHeader, mek, salt, TEST_PARAMS);
      // Tamper with a byte in the ciphertext area (after preamble)
      encrypted[PREAMBLE_SIZE + 10] ^= 0xff;
      expect(() => decryptVaultBlob(encrypted, mek)).toThrow();
    });

    it('Zod-validates the decrypted blob', async () => {
      const salt = generateSyncSalt();
      const mek = await deriveMEK(TEST_PASSWORD, salt, TEST_PARAMS);

      // Construct a bad blob manually: valid preamble + encrypted invalid JSON shape
      const badPayload = JSON.stringify({ version: 999, notAValidField: true });
      const encoder = new TextEncoder();
      const badCiphertext = encrypt(encoder.encode(badPayload), mek);

      // Build preamble
      const preamble = new Uint8Array(PREAMBLE_SIZE);
      preamble.set(salt, 0);
      const view = new DataView(preamble.buffer, preamble.byteOffset, preamble.byteLength);
      view.setUint32(16, TEST_PARAMS.t, true);
      view.setUint32(20, TEST_PARAMS.m, true);
      view.setUint32(24, TEST_PARAMS.p, true);
      view.setUint32(28, TEST_PARAMS.dkLen, true);

      const fullBlob = new Uint8Array(PREAMBLE_SIZE + badCiphertext.length);
      fullBlob.set(preamble, 0);
      fullBlob.set(badCiphertext, PREAMBLE_SIZE);

      expect(() => decryptVaultBlob(fullBlob, mek)).toThrow();
    });
  });

  describe('readPreambleFromBlob', () => {
    it('extracts salt and params', async () => {
      const salt = generateSyncSalt();
      const mek = await deriveMEK(TEST_PASSWORD, salt, TEST_PARAMS);
      const manifest = makeManifest();
      const vaultHeader = randomBytes(64);

      const encrypted = encryptVaultBlob(manifest, vaultHeader, mek, salt, TEST_PARAMS);
      const preamble = readPreambleFromBlob(encrypted);

      expect(preamble.syncSalt).toEqual(salt);
      expect(preamble.argon2Params).toEqual(TEST_PARAMS);
    });

    it('throws on short data', () => {
      expect(() => readPreambleFromBlob(new Uint8Array(31))).toThrow();
      expect(() => readPreambleFromBlob(new Uint8Array(0))).toThrow();
    });
  });

  describe('VaultBlobSchema', () => {
    it('validates a correct blob', () => {
      const result = VaultBlobSchema.safeParse({
        version: 1,
        argon2Params: TEST_PARAMS,
        vaultHeader: toBase64(randomBytes(64)),
        manifest: makeManifest(),
      });
      expect(result.success).toBe(true);
    });

    it('rejects missing fields', () => {
      const result = VaultBlobSchema.safeParse({ version: 1 });
      expect(result.success).toBe(false);
    });
  });
});
