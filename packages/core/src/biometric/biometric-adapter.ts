/**
 * Platform-agnostic biometric adapter interface.
 *
 * Each platform (mobile, desktop) provides its own implementation
 * backed by the OS secure enclave (Keychain, Windows Hello, etc.).
 */

/** Discriminated result from a biometric DEK retrieval attempt. */
export type BiometricResult =
  | { status: 'success'; dek: Uint8Array }
  | { status: 'cancelled' }
  | { status: 'invalidated' }
  | { status: 'error'; message: string };

/** Interface for platform biometric DEK storage. */
export interface BiometricAdapter {
  /** Check if biometric hardware is available and enrolled. */
  isAvailable(): Promise<boolean>;

  /** Store DEK in secure enclave. Does NOT zero the input DEK. */
  saveDEK(dek: Uint8Array): Promise<void>;

  /**
   * Retrieve DEK from secure enclave (triggers biometric prompt).
   *
   * Returns a discriminated result:
   * - 'success': DEK retrieved, proceed with unlock
   * - 'cancelled': user dismissed prompt, show fallback options
   * - 'invalidated': enrollment changed or DEK expired, auto-clear
   * - 'error': hardware/OS error, show error message
   */
  loadDEK(): Promise<BiometricResult>;

  /** Remove stored DEK from secure enclave. */
  clearDEK(): Promise<void>;
}
