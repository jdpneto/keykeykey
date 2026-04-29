/**
 * Platform seam for OS-backed biometric byte storage.
 *
 * An `OSBiometricStore` is the *thinnest* thing each platform must implement:
 * read/write opaque bytes to a biometric-gated location, with the OS-level
 * disposition surfaced as a discriminated `LoadBytesResult`.
 *
 * The string `value` is opaque at this layer — encode/decode happens in core
 * (see `dek-payload.ts`). The "is this a cancellation vs. an enrollment-change
 * vs. a real error" decision lives in the platform implementation, where the
 * vendor-specific error shapes are known. Core never matches on platform error
 * strings.
 */

export type LoadBytesResult =
  /** Bytes retrieved successfully. */
  | { status: 'ok'; value: string }
  /** Nothing is stored under the biometric key. */
  | { status: 'absent' }
  /** User dismissed the biometric prompt. */
  | { status: 'cancelled' }
  /** Enrollment changed (Touch ID rotated, biometrics cleared) — auto-clear and re-enroll. */
  | { status: 'invalidated' }
  /** Hardware/OS error that the user can't be expected to act on. */
  | { status: 'error'; message: string };

export interface OSBiometricStore {
  /** Whether biometric hardware is present and at least one credential is enrolled. */
  isAvailable(): Promise<boolean>;
  /** Persist `value` under the biometric key, replacing any prior bytes. */
  saveBytes(value: string): Promise<void>;
  /** Read the stored bytes (triggers a biometric prompt). */
  loadBytes(): Promise<LoadBytesResult>;
  /** Remove the stored bytes. Idempotent. */
  clearBytes(): Promise<void>;
}
