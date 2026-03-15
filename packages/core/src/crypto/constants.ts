/**
 * Cryptographic constants and parameter presets for KeyKeyKey vault encryption.
 *
 * All sizes are in bytes. Argon2id parameters follow OWASP recommendations:
 * - Desktop: Strong preset (64 MiB memory, 3 iterations, 4 parallelism)
 * - Mobile/Browser: OWASP minimum (19 MiB memory, 2 iterations, 1 parallelism)
 *
 * @see https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html
 */

/** Argon2id tuning parameters for key derivation. */
export type Argon2Params = {
  /** Time cost — number of iterations (t) */
  readonly t: number;
  /** Memory cost in KiB (m) */
  readonly m: number;
  /** Parallelism degree (p) */
  readonly p: number;
  /** Derived key length in bytes */
  readonly dkLen: number;
};

/**
 * Per-platform Argon2id parameter presets.
 *
 * These can be upgraded over time and are stored in the vault header
 * so old vaults continue to work after a parameter bump.
 */
export const ARGON2_PRESETS = {
  /** Desktop: 64 MiB, 3 iterations, 4 parallelism threads */
  desktop: { t: 3, m: 65_536, p: 4, dkLen: 32 } satisfies Argon2Params,
  /** Mobile: 19 MiB, 2 iterations, 1 thread (OWASP minimum) */
  mobile: { t: 2, m: 19_456, p: 1, dkLen: 32 } satisfies Argon2Params,
  /** Browser extension: same as mobile (memory-constrained environment) */
  browser: { t: 2, m: 19_456, p: 1, dkLen: 32 } satisfies Argon2Params,
  /** PIN quick-unlock: same as mobile/browser. Low-entropy PIN is protected by attempt lockout, not KDF alone. */
  pin: { t: 2, m: 19_456, p: 1, dkLen: 32 } satisfies Argon2Params,
} as const;

export type Argon2Preset = keyof typeof ARGON2_PRESETS;

/** 256-bit symmetric key length (DEK and KEK). */
export const KEY_SIZE = 32;

/** 128-bit salt for Argon2id. */
export const SALT_SIZE = 16;

/** 192-bit nonce for XChaCha20-Poly1305. */
export const NONCE_SIZE = 24;

/** 128-bit Poly1305 authentication tag. */
export const TAG_SIZE = 16;

/** Total overhead added by managedNonce XChaCha20-Poly1305: nonce + tag. */
export const MANAGED_NONCE_OVERHEAD = NONCE_SIZE + TAG_SIZE; // 40 bytes

/** Current vault header schema version. */
export const VAULT_VERSION = 2;

/** Length in bytes for the raw recovery key (128 bits). */
export const RECOVERY_KEY_BYTES = 16;
