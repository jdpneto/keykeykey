import { describe, it, expect } from 'vitest';
import { encrypt, decrypt } from './encryption.js';
import { KEY_SIZE, MANAGED_NONCE_OVERHEAD } from './constants.js';
import { randomBytes } from '@noble/hashes/utils';

/** Generate a random 32-byte key for testing. */
function randomKey(): Uint8Array {
  return randomBytes(KEY_SIZE);
}

describe('encrypt', () => {
  it('should produce ciphertext longer than plaintext by MANAGED_NONCE_OVERHEAD', () => {
    const key = randomKey();
    const plaintext = new TextEncoder().encode('Hello, KeyKeyKey!');

    const ciphertext = encrypt(plaintext, key);

    expect(ciphertext.length).toBe(plaintext.length + MANAGED_NONCE_OVERHEAD);
  });

  it('should produce different ciphertext for the same plaintext (unique nonces)', () => {
    const key = randomKey();
    const plaintext = new TextEncoder().encode('same data');

    const ct1 = encrypt(plaintext, key);
    const ct2 = encrypt(plaintext, key);

    // Nonces differ, so ciphertext must differ
    expect(ct1).not.toEqual(ct2);
  });

  it('should work with empty plaintext', () => {
    const key = randomKey();
    const plaintext = new Uint8Array(0);

    const ciphertext = encrypt(plaintext, key);

    expect(ciphertext.length).toBe(MANAGED_NONCE_OVERHEAD);
  });

  it('should throw if key is wrong length', () => {
    const shortKey = new Uint8Array(16);
    const plaintext = new Uint8Array(10);

    expect(() => encrypt(plaintext, shortKey)).toThrow(`Key must be ${KEY_SIZE} bytes, got 16`);
  });

  it('should work with large payloads', () => {
    const key = randomKey();
    const plaintext = randomBytes(1024 * 64); // 64 KiB

    const ciphertext = encrypt(plaintext, key);

    expect(ciphertext.length).toBe(plaintext.length + MANAGED_NONCE_OVERHEAD);
  });
});

describe('decrypt', () => {
  it('should round-trip encrypt → decrypt', () => {
    const key = randomKey();
    const original = new TextEncoder().encode('round-trip test data');

    const ciphertext = encrypt(original, key);
    const decrypted = decrypt(ciphertext, key);

    expect(decrypted).toEqual(original);
  });

  it('should round-trip with empty plaintext', () => {
    const key = randomKey();
    const original = new Uint8Array(0);

    const ciphertext = encrypt(original, key);
    const decrypted = decrypt(ciphertext, key);

    expect(decrypted).toEqual(original);
  });

  it('should throw on tampered ciphertext', () => {
    const key = randomKey();
    const plaintext = new TextEncoder().encode('sensitive data');

    const ciphertext = encrypt(plaintext, key);

    // Flip a byte in the encrypted payload (past the nonce)
    const tampered = new Uint8Array(ciphertext);
    tampered[30] ^= 0xff; // byte 30 is in the ciphertext region

    expect(() => decrypt(tampered, key)).toThrow();
  });

  it('should throw with wrong key', () => {
    const key1 = randomKey();
    const key2 = randomKey();
    const plaintext = new TextEncoder().encode('wrong key test');

    const ciphertext = encrypt(plaintext, key1);

    expect(() => decrypt(ciphertext, key2)).toThrow();
  });

  it('should throw if key is wrong length', () => {
    const shortKey = new Uint8Array(16);
    const ciphertext = new Uint8Array(50);

    expect(() => decrypt(ciphertext, shortKey)).toThrow(`Key must be ${KEY_SIZE} bytes, got 16`);
  });

  it('should throw on truncated ciphertext', () => {
    const key = randomKey();
    const plaintext = new TextEncoder().encode('will be truncated');

    const ciphertext = encrypt(plaintext, key);
    const truncated = ciphertext.slice(0, 10);

    expect(() => decrypt(truncated, key)).toThrow();
  });

  it('should round-trip binary data with all byte values', () => {
    const key = randomKey();
    const original = new Uint8Array(256);
    for (let i = 0; i < 256; i++) {
      original[i] = i;
    }

    const ciphertext = encrypt(original, key);
    const decrypted = decrypt(ciphertext, key);

    expect(decrypted).toEqual(original);
  });
});
