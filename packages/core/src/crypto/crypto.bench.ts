/**
 * Performance benchmarks for cryptographic operations.
 *
 * Targets (per implementation plan §7.8):
 * - Argon2id key derivation: <500ms per unlock on modern hardware at chosen params
 * - XChaCha20-Poly1305 encrypt/decrypt: >100 MB/s throughput for bulk operations
 *
 * Run with: pnpm --filter @keykeykey/core bench
 */

import { bench, describe } from 'vitest';
import { deriveKEK } from './kdf.js';
import { encrypt, decrypt } from './encryption.js';
import { generateDEK, wrapDEK, unwrapDEK } from './dek.js';
import { generateRecoveryKey } from './recovery.js';
import { ARGON2_PRESETS, SALT_SIZE, KEY_SIZE } from './constants.js';
import { randomBytes as nobleRandomBytes } from '@noble/hashes/utils';
import { randomBytes as nodeRandomBytes } from 'node:crypto';

// Noble randomBytes is limited to 65536 bytes per call (browser WebCrypto limit).
// Use Node's crypto for large payload generation in benchmarks only.
function largeRandomBytes(size: number): Uint8Array {
  return new Uint8Array(nodeRandomBytes(size));
}

const salt = nobleRandomBytes(SALT_SIZE);
const password = 'benchmark-master-password-2024';
const key = nobleRandomBytes(KEY_SIZE);

// Pre-allocate payloads for throughput benchmarks
const payload1KB = largeRandomBytes(1024);
const payload64KB = largeRandomBytes(64 * 1024);
const payload1MB = largeRandomBytes(1024 * 1024);

const encrypted1KB = encrypt(payload1KB, key);
const encrypted64KB = encrypt(payload64KB, key);
const encrypted1MB = encrypt(payload1MB, key);

describe('Argon2id key derivation (per platform preset)', () => {
  bench(
    'mobile/browser preset (t=2, m=19456, p=1) — OWASP minimum',
    async () => {
      await deriveKEK(password, salt, ARGON2_PRESETS.mobile);
    },
    { time: 3000 },
  );

  bench(
    'desktop preset (t=3, m=65536, p=4) — strong',
    async () => {
      await deriveKEK(password, salt, ARGON2_PRESETS.desktop);
    },
    { time: 5000 },
  );
});

describe('XChaCha20-Poly1305 encryption throughput', () => {
  bench('encrypt 1 KB', () => {
    encrypt(payload1KB, key);
  });

  bench('encrypt 64 KB', () => {
    encrypt(payload64KB, key);
  });

  bench('encrypt 1 MB', () => {
    encrypt(payload1MB, key);
  });

  bench('decrypt 1 KB', () => {
    decrypt(encrypted1KB, key);
  });

  bench('decrypt 64 KB', () => {
    decrypt(encrypted64KB, key);
  });

  bench('decrypt 1 MB', () => {
    decrypt(encrypted1MB, key);
  });
});

describe('DEK envelope encryption', () => {
  bench('generateDEK (random 256-bit key)', () => {
    generateDEK();
  });

  bench('wrapDEK (encrypt DEK with KEK)', () => {
    wrapDEK(key, key);
  });

  const wrapped = wrapDEK(key, key);
  bench('unwrapDEK (decrypt DEK with KEK)', () => {
    unwrapDEK(wrapped, key);
  });
});

describe('Recovery key', () => {
  bench('generateRecoveryKey (128-bit Base32)', () => {
    generateRecoveryKey();
  });
});
