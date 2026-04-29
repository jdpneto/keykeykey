import { invoke } from '@tauri-apps/api/core';
import {
  createBiometricAdapter,
  type BiometricAdapter,
  type LoadBytesResult,
  type OSBiometricStore,
} from '@keykeykey/core/biometric';

/**
 * Desktop `OSBiometricStore` — Tauri `biometric_*` commands backed by a
 * Touch ID-gated Keychain item on macOS, stub on other platforms.
 *
 * The discriminated `LoadBytesResult` is produced here, where Tauri's error
 * messages are visible. Core never matches on platform error strings.
 */
function createDesktopOSBiometricStore(): OSBiometricStore {
  return {
    async isAvailable(): Promise<boolean> {
      try {
        return await invoke<boolean>('biometric_is_available');
      } catch {
        return false;
      }
    },

    async saveBytes(value: string): Promise<void> {
      await invoke('biometric_save_dek', { value });
    },

    async loadBytes(): Promise<LoadBytesResult> {
      try {
        const raw = await invoke<string | null>('biometric_load_dek');
        if (raw === null) return { status: 'absent' };
        return { status: 'ok', value: raw };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Biometric error';
        if (message.includes('cancel') || message.includes('Cancel')) {
          return { status: 'cancelled' };
        }
        return { status: 'error', message };
      }
    },

    async clearBytes(): Promise<void> {
      try {
        await invoke('biometric_clear_dek');
      } catch {
        // clear is idempotent
      }
    },
  };
}

export function createDesktopBiometricAdapter(): BiometricAdapter {
  return createBiometricAdapter(createDesktopOSBiometricStore());
}
