/**
 * Build a `BiometricAdapter` from a thinner platform `OSBiometricStore`.
 *
 * The factory owns every cross-platform invariant: the JSON+base64 envelope,
 * the 14-day age policy, the auto-clear-and-invalidate handshake, and the
 * mapping from `LoadBytesResult` to `BiometricResult`. Platforms only have to
 * implement the OS-bytes I/O — adding Windows Hello or Android Keystore is
 * "implement `OSBiometricStore`," not "re-derive these invariants."
 */

import type { BiometricAdapter, BiometricResult } from './biometric-adapter.js';
import type { OSBiometricStore } from './os-biometric-store.js';
import { decodeDEKPayload, encodeDEKPayload, isExpired } from './dek-payload.js';

export function createBiometricAdapter(store: OSBiometricStore): BiometricAdapter {
  return {
    isAvailable: () => store.isAvailable(),

    async saveDEK(dek: Uint8Array): Promise<void> {
      await store.saveBytes(encodeDEKPayload(dek));
    },

    async loadDEK(): Promise<BiometricResult> {
      const result = await store.loadBytes();
      switch (result.status) {
        case 'absent':
          return { status: 'invalidated' };
        case 'cancelled':
          return { status: 'cancelled' };
        case 'invalidated':
          // Platform already knows enrollment changed; clean up and report.
          await store.clearBytes().catch(() => {});
          return { status: 'invalidated' };
        case 'error':
          return { status: 'error', message: result.message };
        case 'ok':
          break;
      }

      let decoded: { dek: Uint8Array; savedAt: string };
      try {
        decoded = decodeDEKPayload(result.value);
      } catch {
        // Corrupt envelope — treat as invalidated and wipe the bad bytes.
        await store.clearBytes().catch(() => {});
        return { status: 'invalidated' };
      }

      if (isExpired(decoded.savedAt)) {
        await store.clearBytes().catch(() => {});
        return { status: 'invalidated' };
      }

      return { status: 'success', dek: decoded.dek };
    },

    clearDEK: () => store.clearBytes(),
  };
}
