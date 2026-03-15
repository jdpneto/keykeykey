/**
 * Unlock method priority logic.
 *
 * Determines which unlock method to present first based on
 * what's configured and available on the current device.
 * Priority: biometric → pin → password.
 */

export type UnlockMethod = 'biometric' | 'pin' | 'password';

export interface UnlockAvailability {
  /** BiometricAdapter.isAvailable() && DEK stored && not expired */
  biometric: boolean;
  /** PinData exists in platform storage */
  pin: boolean;
  /** Always true — master password is always available */
  password: boolean;
}

/** Returns the highest-priority available unlock method. */
export function getDefaultMethod(availability: UnlockAvailability): UnlockMethod {
  if (availability.biometric) return 'biometric';
  if (availability.pin) return 'pin';
  return 'password';
}
