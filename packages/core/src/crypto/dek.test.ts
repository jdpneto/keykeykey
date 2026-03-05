import { describe, it, expect } from 'vitest';
import { generateDEK, wrapDEK, unwrapDEK } from './dek.js';
import { KEY_SIZE, MANAGED_NONCE_OVERHEAD } from './constants.js';
import { randomBytes } from '@noble/hashes/utils';

describe('generateDEK', () => {
  it('should produce a 32-byte key', () => {
    const dek = generateDEK();
    expect(dek).toBeInstanceOf(Uint8Array);
    expect(dek.length).toBe(KEY_SIZE);
  });

  it('should produce unique keys each call (randomness)', () => {
    const dek1 = generateDEK();
    const dek2 = generateDEK();
    expect(dek1).not.toEqual(dek2);
  });
});

describe('wrapDEK / unwrapDEK', () => {
  it('should round-trip wrap → unwrap', () => {
    const dek = generateDEK();
    const kek = randomBytes(KEY_SIZE);

    const wrapped = wrapDEK(dek, kek);
    const unwrapped = unwrapDEK(wrapped, kek);

    expect(unwrapped).toEqual(dek);
  });

  it('should produce wrapped output with correct size', () => {
    const dek = generateDEK();
    const kek = randomBytes(KEY_SIZE);

    const wrapped = wrapDEK(dek, kek);

    expect(wrapped.length).toBe(KEY_SIZE + MANAGED_NONCE_OVERHEAD);
  });

  it('should throw if DEK is wrong length', () => {
    const badDEK = new Uint8Array(16);
    const kek = randomBytes(KEY_SIZE);

    expect(() => wrapDEK(badDEK, kek)).toThrow(`DEK must be ${KEY_SIZE} bytes, got 16`);
  });

  it('should throw if wrong KEK is used for unwrap', () => {
    const dek = generateDEK();
    const kek1 = randomBytes(KEY_SIZE);
    const kek2 = randomBytes(KEY_SIZE);

    const wrapped = wrapDEK(dek, kek1);

    expect(() => unwrapDEK(wrapped, kek2)).toThrow();
  });

  it('should throw if wrapped DEK is tampered', () => {
    const dek = generateDEK();
    const kek = randomBytes(KEY_SIZE);

    const wrapped = wrapDEK(dek, kek);
    const tampered = new Uint8Array(wrapped);
    tampered[wrapped.length - 1] ^= 0xff;

    expect(() => unwrapDEK(tampered, kek)).toThrow();
  });

  it('should produce different wrapped output each time (unique nonce)', () => {
    const dek = generateDEK();
    const kek = randomBytes(KEY_SIZE);

    const wrapped1 = wrapDEK(dek, kek);
    const wrapped2 = wrapDEK(dek, kek);

    expect(wrapped1).not.toEqual(wrapped2);
  });
});
