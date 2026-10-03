/**
 * Performance benchmarks for cryptographic operations.
 *
 * Targets (per implementation plan §7.8):
 * - Argon2id key derivation: <500ms per unlock on modern hardware at chosen params
 * - XChaCha20-Poly1305 encrypt/decrypt: >100 MB/s throughput for bulk operations
 *
 * Run with: pnpm --filter @keykeykey/core bench
 *
 * Vitest 5 benchmarks are registered from a test's `bench` fixture; each
 * `bench.compare()` prints a comparison table for its group.
 */

import { describe, test } from 'vitest';
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

// Benchmarks run far longer than the default 5s test timeout (the Argon2id
// benches need >= 64 samples at ~0.4-1s each).
const BENCH_TIMEOUT = 300_000;

describe('Argon2id key derivation (per platform preset)', () => {
  test(
    'mobile/browser preset (t=2, m=19456, p=1) — OWASP minimum',
    async ({ bench }) => {
      await bench('mobile/browser preset (t=2, m=19456, p=1) — OWASP minimum', async () => {
        await deriveKEK(password, salt, ARGON2_PRESETS.mobile);
      }).run({ time: 3000 });
    },
    BENCH_TIMEOUT,
  );

  test(
    'desktop preset (t=2, m=19456, p=1) — unified with mobile/browser',
    async ({ bench }) => {
      await bench('desktop preset (t=2, m=19456, p=1) — unified with mobile/browser', async () => {
        await deriveKEK(password, salt, ARGON2_PRESETS.desktop);
      }).run({ time: 5000 });
    },
    BENCH_TIMEOUT,
  );
});

describe('XChaCha20-Poly1305 encryption throughput', () => {
  test(
    'encrypt / decrypt at 1 KB, 64 KB and 1 MB',
    async ({ bench }) => {
      await bench.compare(
        bench('encrypt 1 KB', () => {
          encrypt(payload1KB, key);
        }),
        bench('encrypt 64 KB', () => {
          encrypt(payload64KB, key);
        }),
        bench('encrypt 1 MB', () => {
          encrypt(payload1MB, key);
        }),
        bench('decrypt 1 KB', () => {
          decrypt(encrypted1KB, key);
        }),
        bench('decrypt 64 KB', () => {
          decrypt(encrypted64KB, key);
        }),
        bench('decrypt 1 MB', () => {
          decrypt(encrypted1MB, key);
        }),
      );
    },
    BENCH_TIMEOUT,
  );
});

describe('DEK envelope encryption', () => {
  test(
    'generate / wrap / unwrap DEK',
    async ({ bench }) => {
      const wrapped = wrapDEK(key, key);
      await bench.compare(
        bench('generateDEK (random 256-bit key)', () => {
          generateDEK();
        }),
        bench('wrapDEK (encrypt DEK with KEK)', () => {
          wrapDEK(key, key);
        }),
        bench('unwrapDEK (decrypt DEK with KEK)', () => {
          unwrapDEK(wrapped, key);
        }),
      );
    },
    BENCH_TIMEOUT,
  );
});

describe('Recovery key', () => {
  test(
    'generateRecoveryKey (128-bit Base32)',
    async ({ bench }) => {
      await bench('generateRecoveryKey (128-bit Base32)', () => {
        generateRecoveryKey();
      }).run();
    },
    BENCH_TIMEOUT,
  );
});
