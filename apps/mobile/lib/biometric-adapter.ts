/**
 * Mobile BiometricAdapter implementation using expo-secure-store
 * and expo-local-authentication.
 *
 * Stores the DEK + timestamp as a JSON blob in SecureStore with
 * requireAuthentication: true (triggers FaceID/TouchID on retrieval).
 */

import {
  saveBiometricDEK,
  loadBiometricDEK,
  deleteBiometricDEK,
  saveBiometricDEKFingerprint,
} from './storage';
import type { BiometricAdapter, BiometricResult } from '@keykeykey/core/biometric';
import { toBase64, fromBase64 } from '@keykeykey/core/utils';
import { dekFingerprint } from './dek-fingerprint';
import * as LocalAuthentication from 'expo-local-authentication';

/** Maximum age for stored biometric DEK (14 days in ms). */
const MAX_DEK_AGE_MS = 14 * 24 * 60 * 60 * 1000;

export function createMobileBiometricAdapter(): BiometricAdapter {
  return {
    async isAvailable(): Promise<boolean> {
      const compatible = await LocalAuthentication.hasHardwareAsync();
      const enrolled = await LocalAuthentication.isEnrolledAsync();
      return compatible && enrolled;
    },

    async saveDEK(dek: Uint8Array): Promise<void> {
      const fp = dekFingerprint(dek);
      const payload = JSON.stringify({
        dek: toBase64(dek),
        savedAt: new Date().toISOString(),
        // Fingerprint is also embedded here for completeness, but the
        // authoritative copy for silent validation lives in the non-
        // protected sibling key (see saveBiometricDEKFingerprint). The
        // biometric_dek item itself is ACL-protected; reading it would
        // trigger a Face ID prompt that's unacceptable during a silent
        // master-password unlock reconcile.
        dekFingerprint: fp,
      });
      await saveBiometricDEK(payload);
      await saveBiometricDEKFingerprint(fp);
    },

    async loadDEK(): Promise<BiometricResult> {
      try {
        const raw = await loadBiometricDEK();
        if (!raw) {
          return { status: 'invalidated' };
        }

        const { dek: dekBase64, savedAt } = JSON.parse(raw) as { dek: string; savedAt: string };

        // Check expiry
        const age = Date.now() - new Date(savedAt).getTime();
        if (age > MAX_DEK_AGE_MS) {
          await deleteBiometricDEK();
          return { status: 'invalidated' };
        }

        return { status: 'success', dek: fromBase64(dekBase64) };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Biometric error';

        // expo-secure-store throws specific errors for cancellation
        if (message.includes('cancel') || message.includes('Cancel')) {
          return { status: 'cancelled' };
        }

        // Enrollment changes cause authentication failure
        if (message.includes('authentication') || message.includes('not enrolled')) {
          await deleteBiometricDEK().catch(() => {});
          return { status: 'invalidated' };
        }

        return { status: 'error', message };
      }
    },

    async clearDEK(): Promise<void> {
      await deleteBiometricDEK();
    },
  };
}
