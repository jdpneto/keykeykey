/**
 * Platform-pluggable Argon2id hashing adapter.
 *
 * Allows each platform to provide its own Argon2id implementation:
 * - Mobile: native C module via Expo (async, runs on native thread — ~0.5s)
 * - Desktop (Tauri): Rust argon2 crate via Tauri command
 * - Browser / Tests: @noble/hashes JS fallback (pure TypeScript)
 *
 * The JS fallback is used automatically when no native adapter is configured,
 * so tests work with zero configuration.
 */

import { argon2id } from '@noble/hashes/argon2';
import type { Argon2Params } from './constants.js';

/**
 * Adapter interface for platform-specific Argon2id implementations.
 *
 * Each platform provides an implementation of this interface and registers
 * it via `setArgon2Adapter()` at app startup.
 */
export interface Argon2Adapter {
  hash(password: Uint8Array, salt: Uint8Array, params: Argon2Params): Promise<Uint8Array>;
}

/**
 * JS fallback adapter wrapping @noble/hashes/argon2.
 * Used automatically when no native adapter is configured.
 */
export const jsArgon2Adapter: Argon2Adapter = {
  async hash(
    password: Uint8Array,
    salt: Uint8Array,
    params: Argon2Params,
  ): Promise<Uint8Array> {
    return argon2id(password, salt, {
      t: params.t,
      m: params.m,
      p: params.p,
      dkLen: params.dkLen,
    });
  },
};

let currentAdapter: Argon2Adapter = jsArgon2Adapter;

/**
 * Set the global Argon2id adapter. Call once at app startup.
 * If never called, the JS fallback is used (suitable for tests and browser).
 */
export function setArgon2Adapter(adapter: Argon2Adapter): void {
  currentAdapter = adapter;
}

/**
 * Get the current Argon2id adapter.
 * @internal Used by deriveKEK — not part of the public API.
 */
export function getArgon2Adapter(): Argon2Adapter {
  return currentAdapter;
}
