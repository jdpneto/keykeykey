/**
 * Mobile `BiometricAdapter` — wraps a mobile `OSBiometricStore` (expo-secure-
 * store, Keychain ACL on iOS, BIOMETRIC_STRONG on Android) with the core
 * factory, plus the iOS-only side effect of mirroring the DEK fingerprint to
 * a non-protected sibling key. Reading the biometric DEK item directly to
 * compute its fingerprint would trigger a Face ID prompt, which is
 * unacceptable during a silent master-password unlock reconcile — the sibling
 * key lets the main app check identity without authentication. Fingerprints
 * are SHA-256 truncations and are not secrets.
 */

import {
  saveBiometricDEK,
  loadBiometricDEK,
  deleteBiometricDEK,
  saveBiometricDEKFingerprint,
} from './storage';
import {
  createBiometricAdapter,
  type BiometricAdapter,
  type LoadBytesResult,
  type OSBiometricStore,
} from '@keykeykey/core/biometric';
import { dekFingerprint } from './dek-fingerprint';
import * as LocalAuthentication from 'expo-local-authentication';

function createMobileOSBiometricStore(): OSBiometricStore {
  return {
    async isAvailable(): Promise<boolean> {
      const compatible = await LocalAuthentication.hasHardwareAsync();
      const enrolled = await LocalAuthentication.isEnrolledAsync();
      return compatible && enrolled;
    },

    async saveBytes(value: string): Promise<void> {
      await saveBiometricDEK(value);
    },

    async loadBytes(): Promise<LoadBytesResult> {
      try {
        const raw = await loadBiometricDEK();
        if (raw === null) return { status: 'absent' };
        return { status: 'ok', value: raw };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Biometric error';
        if (message.includes('cancel') || message.includes('Cancel')) {
          return { status: 'cancelled' };
        }
        // expo-secure-store surfaces enrollment changes as an authentication
        // error; treat as invalidated so the caller re-enrolls instead of
        // showing a generic error.
        if (message.includes('authentication') || message.includes('not enrolled')) {
          return { status: 'invalidated' };
        }
        return { status: 'error', message };
      }
    },

    async clearBytes(): Promise<void> {
      await deleteBiometricDEK();
    },
  };
}

export function createMobileBiometricAdapter(): BiometricAdapter {
  const inner = createBiometricAdapter(createMobileOSBiometricStore());
  return {
    ...inner,
    async saveDEK(dek: Uint8Array): Promise<void> {
      await inner.saveDEK(dek);
      // Sibling non-protected key for silent identity checks during
      // master-password unlock reconcile. See file header for why.
      await saveBiometricDEKFingerprint(dekFingerprint(dek));
    },
  };
}
