import { invoke } from '@tauri-apps/api/core';
import type { BiometricAdapter, BiometricResult } from '@keykeykey/core/biometric';
import { toBase64, fromBase64 } from '@keykeykey/core/utils';

const MAX_DEK_AGE_MS = 14 * 24 * 60 * 60 * 1000;

export function createDesktopBiometricAdapter(): BiometricAdapter {
  return {
    async isAvailable(): Promise<boolean> {
      try {
        return await invoke<boolean>('biometric_is_available');
      } catch {
        return false;
      }
    },

    async saveDEK(dek: Uint8Array): Promise<void> {
      const payload = JSON.stringify({
        dek: toBase64(dek),
        savedAt: new Date().toISOString(),
      });
      await invoke('biometric_save_dek', { value: payload });
    },

    async loadDEK(): Promise<BiometricResult> {
      try {
        const raw = await invoke<string | null>('biometric_load_dek');
        if (!raw) return { status: 'invalidated' };

        const { dek: dekBase64, savedAt } = JSON.parse(raw) as {
          dek: string;
          savedAt: string;
        };
        const age = Date.now() - new Date(savedAt).getTime();
        if (age > MAX_DEK_AGE_MS) {
          await invoke('biometric_clear_dek');
          return { status: 'invalidated' };
        }

        return { status: 'success', dek: fromBase64(dekBase64) };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Biometric error';
        if (message.includes('cancel') || message.includes('Cancel')) {
          return { status: 'cancelled' };
        }
        return { status: 'error', message };
      }
    },

    async clearDEK(): Promise<void> {
      try {
        await invoke('biometric_clear_dek');
      } catch {
        // Ignore errors on clear
      }
    },
  };
}
