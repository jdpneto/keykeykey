/**
 * Property-based tests for crypto module using fast-check.
 *
 * These tests verify invariants that must hold for ALL inputs:
 * - Encrypt → Decrypt always recovers original plaintext
 * - Every encryption produces unique ciphertext (nonce uniqueness)
 * - Tampering any byte in ciphertext causes decryption to fail
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { encrypt, decrypt } from './encryption.js';
import { generateDEK, wrapDEK, unwrapDEK } from './dek.js';
import { KEY_SIZE } from './constants.js';

/** Arbitrary for a valid 32-byte key. */
const arbKey = fc.uint8Array({ minLength: KEY_SIZE, maxLength: KEY_SIZE });

/** Arbitrary for plaintext of varying sizes (0 to 4 KiB). */
const arbPlaintext = fc.uint8Array({ minLength: 0, maxLength: 4096 });

describe('encryption property tests', () => {
  it('should always recover plaintext after encrypt → decrypt', () => {
    fc.assert(
      fc.property(arbPlaintext, arbKey, (plaintext, key) => {
        const ciphertext = encrypt(plaintext, key);
        const decrypted = decrypt(ciphertext, key);
        expect(decrypted).toEqual(plaintext);
      }),
      { numRuns: 100 },
    );
  });

  it('should produce unique ciphertext for the same plaintext (nonce uniqueness)', () => {
    fc.assert(
      fc.property(arbPlaintext, arbKey, (plaintext, key) => {
        const ct1 = encrypt(plaintext, key);
        const ct2 = encrypt(plaintext, key);
        // Two encryptions of the same data must differ (different random nonces)
        expect(ct1).not.toEqual(ct2);
      }),
      { numRuns: 50 },
    );
  });

  it('should fail decryption when any byte in ciphertext is tampered', () => {
    fc.assert(
      fc.property(
        arbPlaintext.filter((p) => p.length > 0), // need non-empty to have tamperable ciphertext
        arbKey,
        (plaintext, key) => {
          const ciphertext = encrypt(plaintext, key);

          // Pick a random position to tamper
          const pos = Math.floor(Math.random() * ciphertext.length);
          const tampered = new Uint8Array(ciphertext);
          tampered[pos] = (tampered[pos]! ^ 0xff) as number;

          expect(() => decrypt(tampered, key)).toThrow();
        },
      ),
      { numRuns: 50 },
    );
  });

  it('should fail decryption with a different key', () => {
    fc.assert(
      fc.property(arbPlaintext, arbKey, arbKey, (plaintext, key1, key2) => {
        // Skip if keys happen to be identical
        if (key1.every((b, i) => b === key2[i])) return;

        const ciphertext = encrypt(plaintext, key1);
        expect(() => decrypt(ciphertext, key2)).toThrow();
      }),
      { numRuns: 50 },
    );
  });
});

describe('DEK wrap/unwrap property tests', () => {
  it('should always recover DEK after wrap → unwrap', () => {
    fc.assert(
      fc.property(arbKey, (kek) => {
        const dek = generateDEK();
        const wrapped = wrapDEK(dek, kek);
        const unwrapped = unwrapDEK(wrapped, kek);
        expect(unwrapped).toEqual(dek);
      }),
      { numRuns: 50 },
    );
  });
});
