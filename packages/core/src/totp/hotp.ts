/**
 * HOTP (RFC 4226) — the counter-based primitive that TOTP is built on.
 *
 * Uses @noble/hashes for HMAC, same dependency the rest of the crypto
 * module already relies on.
 */

import { hmac } from '@noble/hashes/hmac';
import { sha1 } from '@noble/hashes/sha1';
import { sha256 } from '@noble/hashes/sha256';
import { sha512 } from '@noble/hashes/sha512';

export type HotpAlgorithm = 'SHA-1' | 'SHA-256' | 'SHA-512';

export interface HotpOptions {
  digits: number;
  algorithm: HotpAlgorithm;
}

const HASH = {
  'SHA-1': sha1,
  'SHA-256': sha256,
  'SHA-512': sha512,
} as const;

function counterToBytes(counter: number): Uint8Array {
  if (!Number.isInteger(counter) || counter < 0) {
    throw new Error(`invalid HOTP counter: ${counter}`);
  }
  const buf = new Uint8Array(8);
  // JS bitwise ops are 32-bit, so split the counter into hi/lo halves.
  const hi = Math.floor(counter / 0x1_0000_0000);
  const lo = counter >>> 0;
  buf[0] = (hi >>> 24) & 0xff;
  buf[1] = (hi >>> 16) & 0xff;
  buf[2] = (hi >>> 8) & 0xff;
  buf[3] = hi & 0xff;
  buf[4] = (lo >>> 24) & 0xff;
  buf[5] = (lo >>> 16) & 0xff;
  buf[6] = (lo >>> 8) & 0xff;
  buf[7] = lo & 0xff;
  return buf;
}

export function generateHotpCode(
  secret: Uint8Array,
  counter: number,
  options: HotpOptions,
): string {
  const { digits, algorithm } = options;
  if (!Number.isInteger(digits) || digits < 6 || digits > 8) {
    throw new Error(`invalid HOTP digits: ${digits} (must be 6, 7, or 8)`);
  }
  const hash = HASH[algorithm];
  if (!hash) throw new Error(`unsupported HOTP algorithm: ${algorithm}`);

  const digest = hmac(hash, secret, counterToBytes(counter));

  // RFC 4226 §5.3 "Dynamic Truncation".
  const offset = digest[digest.length - 1]! & 0x0f;
  const binCode =
    ((digest[offset]! & 0x7f) << 24) |
    ((digest[offset + 1]! & 0xff) << 16) |
    ((digest[offset + 2]! & 0xff) << 8) |
    (digest[offset + 3]! & 0xff);

  const mod = 10 ** digits;
  return String(binCode % mod).padStart(digits, '0');
}
