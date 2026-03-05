/**
 * Recovery key generation and parsing.
 *
 * Recovery keys are 128-bit random values encoded in Base32 for human readability.
 * Format: XXXXX-XXXXX-XXXXX-XXXXX-XXXXX-XX (26 Base32 chars, 5 dashes)
 *
 * The raw bytes are used to derive a recovery KEK via Argon2id.
 * The formatted string is displayed to the user exactly once during vault creation.
 */

import { randomBytes } from '@noble/hashes/utils';
import { RECOVERY_KEY_BYTES } from './constants.js';

/** Base32 alphabet (RFC 4648, no padding). */
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** Reverse lookup table for Base32 decoding. */
const BASE32_LOOKUP: Record<string, number> = {};
for (let i = 0; i < BASE32_ALPHABET.length; i++) {
  BASE32_LOOKUP[BASE32_ALPHABET[i]!] = i;
}

/**
 * Encode bytes to Base32 (RFC 4648, no padding).
 */
function base32Encode(data: Uint8Array): string {
  let result = '';
  let bits = 0;
  let value = 0;

  for (const byte of data) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      result += BASE32_ALPHABET[(value >>> bits) & 0x1f];
    }
  }

  // Encode remaining bits (if any)
  if (bits > 0) {
    result += BASE32_ALPHABET[(value << (5 - bits)) & 0x1f];
  }

  return result;
}

/**
 * Decode a Base32 string (RFC 4648, no padding) to bytes.
 *
 * @throws {Error} If the string contains invalid Base32 characters
 */
function base32Decode(encoded: string): Uint8Array {
  const output: number[] = [];
  let bits = 0;
  let value = 0;

  for (const char of encoded) {
    const idx = BASE32_LOOKUP[char];
    if (idx === undefined) {
      throw new Error(`Invalid Base32 character: '${char}'`);
    }
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      output.push((value >>> bits) & 0xff);
    }
  }

  return new Uint8Array(output);
}

/** Result of generating a recovery key. */
export type RecoveryKeyResult = {
  /** Raw 16-byte recovery key (for KDF derivation). */
  raw: Uint8Array;
  /** Human-readable formatted string (shown to user once). */
  formatted: string;
};

/**
 * Generate a new recovery key.
 *
 * @returns An object with `raw` (16 bytes) and `formatted` (Base32 with dashes)
 */
export function generateRecoveryKey(): RecoveryKeyResult {
  const raw = randomBytes(RECOVERY_KEY_BYTES);
  const encoded = base32Encode(raw);
  const formatted = formatRecoveryKey(encoded);
  return { raw, formatted };
}

/**
 * Format a Base32 string into groups of 5 separated by dashes.
 *
 * 16 bytes = 26 Base32 chars → XXXXX-XXXXX-XXXXX-XXXXX-XXXXX-X
 */
function formatRecoveryKey(encoded: string): string {
  const groups: string[] = [];
  for (let i = 0; i < encoded.length; i += 5) {
    groups.push(encoded.slice(i, i + 5));
  }
  return groups.join('-');
}

/**
 * Parse a formatted recovery key string back to raw bytes.
 *
 * Accepts the formatted form (with dashes) or plain Base32.
 * Case-insensitive.
 *
 * @param formatted - The recovery key string (e.g., "XXXXX-XXXXX-...")
 * @returns Raw 16-byte recovery key
 * @throws {Error} If the format is invalid or decoded length is wrong
 */
export function parseRecoveryKey(formatted: string): Uint8Array {
  // Strip dashes and whitespace, uppercase
  const cleaned = formatted.replace(/[-\s]/g, '').toUpperCase();

  if (cleaned.length === 0) {
    throw new Error('Recovery key cannot be empty');
  }

  // base32Decode validates characters and throws on invalid input
  const raw = base32Decode(cleaned);

  if (raw.length !== RECOVERY_KEY_BYTES) {
    throw new Error(`Recovery key must decode to ${RECOVERY_KEY_BYTES} bytes, got ${raw.length}`);
  }

  return raw;
}
