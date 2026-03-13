/**
 * Native Argon2id adapter for React Native.
 *
 * Wraps `react-native-argon2` (which uses argon2kt on Android and
 * Argon2Swift on iOS) behind the core Argon2Adapter interface.
 *
 * Measured ~70-110ms per KDF call vs 10-30s for the pure-JS fallback.
 */

import argon2 from 'react-native-argon2';
import type { Argon2Adapter } from '@keykeykey/core';

/** Convert Uint8Array to hex string. */
function toHex(bytes: Uint8Array): string {
  const hex: string[] = new Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    hex[i] = bytes[i].toString(16).padStart(2, '0');
  }
  return hex.join('');
}

/** Convert hex string to Uint8Array. */
function fromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/**
 * Native Argon2id adapter backed by react-native-argon2.
 *
 * The native library accepts string password + hex-encoded salt
 * and returns a hex rawHash. We convert to/from Uint8Array at the boundary.
 */
export const nativeArgon2Adapter: Argon2Adapter = {
  async hash(password: Uint8Array, salt: Uint8Array, params): Promise<Uint8Array> {
    // react-native-argon2 takes a string password and a string salt
    const passwordStr = new TextDecoder().decode(password);
    const saltHex = toHex(salt);

    const result = await argon2(passwordStr, saltHex, {
      iterations: params.t,
      memory: params.m,
      parallelism: params.p,
      hashLength: params.dkLen,
      mode: 'argon2id',
      saltEncoding: 'hex',
    });

    return fromHex(result.rawHash);
  },
};
