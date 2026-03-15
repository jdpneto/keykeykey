/**
 * Cross-platform crypto test vectors — verify-only.
 *
 * These tests read committed test vectors (generated once by generate-test-vectors.ts)
 * and verify that the TypeScript crypto functions produce the expected outputs.
 * The same vectors will be used by the Swift iOS credential provider extension
 * to guarantee cross-platform compatibility.
 *
 * This test is safe for CI — it never writes to test-vectors.json.
 */

import { describe, it, expect } from 'vitest';
import { hexToBytes, bytesToHex } from '@noble/hashes/utils';
import { decrypt } from '../encryption.js';
import { unwrapDEK } from '../dek.js';
import { deriveKEK } from '../kdf.js';
import { deserializeVaultHeader, serializeVaultHeader } from '../vault-header.js';
import vectors from './test-vectors.json';

describe('cross-platform test vectors', () => {
  describe('xchacha20poly1305', () => {
    it('should decrypt ciphertext to expected plaintext', () => {
      const key = hexToBytes(vectors.xchacha20poly1305.key);
      const ciphertext = hexToBytes(vectors.xchacha20poly1305.ciphertext);
      const expectedPlaintext = hexToBytes(vectors.xchacha20poly1305.plaintext);

      const plaintext = decrypt(ciphertext, key);

      expect(bytesToHex(plaintext)).toBe(vectors.xchacha20poly1305.plaintext);
      expect(plaintext).toEqual(expectedPlaintext);
    });

    it('should fail with wrong key', () => {
      const wrongKey = hexToBytes(
        'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
      );
      const ciphertext = hexToBytes(vectors.xchacha20poly1305.ciphertext);

      expect(() => decrypt(ciphertext, wrongKey)).toThrow();
    });
  });

  describe('dekUnwrap', () => {
    it('should unwrap DEK to expected value', () => {
      const kek = hexToBytes(vectors.dekUnwrap.kek);
      const wrappedDEK = hexToBytes(vectors.dekUnwrap.wrappedDEK);
      const expectedDEK = hexToBytes(vectors.dekUnwrap.dek);

      const dek = unwrapDEK(wrappedDEK, kek);

      expect(bytesToHex(dek)).toBe(vectors.dekUnwrap.dek);
      expect(dek).toEqual(expectedDEK);
    });

    it('should fail with wrong KEK', () => {
      const wrongKek = hexToBytes(
        'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
      );
      const wrappedDEK = hexToBytes(vectors.dekUnwrap.wrappedDEK);

      expect(() => unwrapDEK(wrappedDEK, wrongKek)).toThrow();
    });
  });

  describe('argon2idPin', () => {
    it('should derive expected key from PIN and salt', async () => {
      const salt = hexToBytes(vectors.argon2idPin.salt);
      const params = vectors.argon2idPin.params;

      const derivedKey = await deriveKEK(vectors.argon2idPin.pin, salt, params);

      expect(bytesToHex(derivedKey)).toBe(vectors.argon2idPin.derivedKey);
    });
  });

  describe('fullCredential', () => {
    it('should decrypt encrypted credential to expected JSON', () => {
      const dek = hexToBytes(vectors.fullCredential.dek);
      const ciphertext = Uint8Array.from(atob(vectors.fullCredential.encryptedDataBase64), (c) =>
        c.charCodeAt(0),
      );

      const plaintext = decrypt(ciphertext, dek);
      const json = new TextDecoder().decode(plaintext);

      expect(json).toBe(vectors.fullCredential.credentialJson);
    });

    it('should contain valid credential fields', () => {
      const credential = JSON.parse(vectors.fullCredential.credentialJson);

      expect(credential.id).toBe('550e8400-e29b-41d4-a716-446655440000');
      expect(credential.type).toBe('credential');
      expect(credential.name).toBe('GitHub');
      expect(credential.username).toBe('user@example.com');
      expect(credential.url).toBe('https://github.com');
      expect(credential.appIdentifiers).toContain('com.github.ios');
    });
  });

  describe('vaultHeader', () => {
    it('should deserialize serialized header and match all fields', () => {
      const serialized = hexToBytes(vectors.vaultHeader.serializedHex);
      const header = deserializeVaultHeader(serialized);

      expect(header.version).toBe(vectors.vaultHeader.version);
      expect(bytesToHex(header.masterSalt)).toBe(vectors.vaultHeader.masterSalt);
      expect(bytesToHex(header.recoverySalt)).toBe(vectors.vaultHeader.recoverySalt);
      expect(header.argon2Params).toEqual(vectors.vaultHeader.argon2Params);
      expect(bytesToHex(header.masterWrappedDEK)).toBe(vectors.vaultHeader.masterWrappedDEK);
      expect(bytesToHex(header.recoveryWrappedDEK)).toBe(vectors.vaultHeader.recoveryWrappedDEK);
    });

    it('should round-trip: serialize then deserialize', () => {
      const serialized = hexToBytes(vectors.vaultHeader.serializedHex);
      const header = deserializeVaultHeader(serialized);
      const reSerialized = serializeVaultHeader(header);

      expect(bytesToHex(reSerialized)).toBe(vectors.vaultHeader.serializedHex);
    });

    it('should reject tampered version byte', () => {
      const serialized = hexToBytes(vectors.vaultHeader.serializedHex);
      serialized[0] = 99; // Invalid version

      expect(() => deserializeVaultHeader(serialized)).toThrow('Unsupported vault version');
    });
  });
});
