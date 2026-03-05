import { describe, it, expect } from 'vitest';
import { deriveKEK } from './kdf.js';
import { ARGON2_PRESETS, SALT_SIZE, KEY_SIZE } from './constants.js';
import type { Argon2Params } from './constants.js';

/** Lightweight params for fast tests (NOT for production use). */
const TEST_PARAMS: Argon2Params = { t: 1, m: 256, p: 1, dkLen: 32 };

describe('deriveKEK', () => {
  it('should derive a 32-byte key from a password and salt', () => {
    const salt = new Uint8Array(SALT_SIZE);
    crypto.getRandomValues(salt);

    const kek = deriveKEK('test-password', salt, TEST_PARAMS);

    expect(kek).toBeInstanceOf(Uint8Array);
    expect(kek.length).toBe(KEY_SIZE);
  });

  it('should produce deterministic output for the same inputs', () => {
    const salt = new Uint8Array(SALT_SIZE).fill(0xab);

    const kek1 = deriveKEK('deterministic-test', salt, TEST_PARAMS);
    const kek2 = deriveKEK('deterministic-test', salt, TEST_PARAMS);

    expect(kek1).toEqual(kek2);
  });

  it('should produce different keys for different passwords', () => {
    const salt = new Uint8Array(SALT_SIZE).fill(0x01);

    const kek1 = deriveKEK('password-one', salt, TEST_PARAMS);
    const kek2 = deriveKEK('password-two', salt, TEST_PARAMS);

    expect(kek1).not.toEqual(kek2);
  });

  it('should produce different keys for different salts', () => {
    const salt1 = new Uint8Array(SALT_SIZE).fill(0x01);
    const salt2 = new Uint8Array(SALT_SIZE).fill(0x02);

    const kek1 = deriveKEK('same-password', salt1, TEST_PARAMS);
    const kek2 = deriveKEK('same-password', salt2, TEST_PARAMS);

    expect(kek1).not.toEqual(kek2);
  });

  it('should throw if salt is wrong length', () => {
    const shortSalt = new Uint8Array(8);
    expect(() => deriveKEK('test', shortSalt, TEST_PARAMS)).toThrow(
      `Salt must be ${SALT_SIZE} bytes, got 8`,
    );

    const longSalt = new Uint8Array(32);
    expect(() => deriveKEK('test', longSalt, TEST_PARAMS)).toThrow(
      `Salt must be ${SALT_SIZE} bytes, got 32`,
    );
  });

  it('should throw if dkLen is not KEY_SIZE', () => {
    const salt = new Uint8Array(SALT_SIZE);
    const badParams: Argon2Params = { t: 1, m: 256, p: 1, dkLen: 16 };

    expect(() => deriveKEK('test', salt, badParams)).toThrow(`dkLen must be ${KEY_SIZE}, got 16`);
  });

  it('should work with empty password', () => {
    const salt = new Uint8Array(SALT_SIZE).fill(0xff);
    const kek = deriveKEK('', salt, TEST_PARAMS);

    expect(kek).toBeInstanceOf(Uint8Array);
    expect(kek.length).toBe(KEY_SIZE);
  });

  it('should work with unicode passwords', () => {
    const salt = new Uint8Array(SALT_SIZE).fill(0xcc);
    const kek = deriveKEK('pässwörd-日本語-🔑', salt, TEST_PARAMS);

    expect(kek).toBeInstanceOf(Uint8Array);
    expect(kek.length).toBe(KEY_SIZE);
  });

  it('should accept all platform presets', () => {
    const salt = new Uint8Array(SALT_SIZE).fill(0x42);

    for (const [preset, params] of Object.entries(ARGON2_PRESETS)) {
      // Use reduced memory for tests but keep preset structure
      const testableParams: Argon2Params = { ...params, m: 256, t: 1 };
      const kek = deriveKEK(`test-${preset}`, salt, testableParams);
      expect(kek.length).toBe(KEY_SIZE);
    }
  });
});
