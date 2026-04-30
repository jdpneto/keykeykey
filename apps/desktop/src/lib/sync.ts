import { invoke } from '@tauri-apps/api/core';
import type { PlatformStorage } from '@keykeykey/core/sync';
import { fromBase64, toBase64 } from '@keykeykey/core/utils';
import {
  saveVaultHeader,
  saveEncryptedItem,
  loadAllEncryptedItems,
  deleteEncryptedItem,
  setVaultSetupComplete,
} from './tauri-storage';
import { setSyncUrlPrefix } from './fetch-proxy';

// ---------------------------------------------------------------------------
// Desktop PlatformStorage factory
// ---------------------------------------------------------------------------

export function createDesktopPlatformStorage(): PlatformStorage {
  return {
    async loadSyncConfigFile(): Promise<Uint8Array | null> {
      const b64 = await invoke<string | null>('load_sync_config');
      if (!b64) return null;
      return fromBase64(b64);
    },
    async saveSyncConfigFile(data: Uint8Array): Promise<void> {
      await invoke('save_sync_config', { dataB64: toBase64(data) });
    },
    async deleteSyncConfigFile(): Promise<void> {
      await invoke('delete_sync_config');
    },
    async saveEncryptedItem(
      id: string,
      type: string,
      encryptedBase64: string,
      createdAt: string,
      updatedAt: string,
    ): Promise<void> {
      await saveEncryptedItem(id, type, encryptedBase64, createdAt, updatedAt);
    },
    async loadAllEncryptedItems(): Promise<Array<{ id: string; encrypted_data: string }>> {
      return loadAllEncryptedItems();
    },
    async deleteAllItems(): Promise<void> {
      const items = await loadAllEncryptedItems();
      for (const item of items) {
        await deleteEncryptedItem(item.id);
      }
    },
    async saveVaultHeader(headerBase64: string): Promise<void> {
      await saveVaultHeader(headerBase64);
    },
    async loadVaultHeader(): Promise<string | null> {
      return invoke<string | null>('load_vault_header');
    },
    async setVaultSetupComplete(complete: boolean): Promise<void> {
      await setVaultSetupComplete(complete);
    },
    async setSyncUrlPrefix(prefix: string | null): Promise<void> {
      await setSyncUrlPrefix(prefix);
    },
  };
}

// ---------------------------------------------------------------------------
// Sync config persistence (kept for clearSyncConfigData used by resetVault)
// ---------------------------------------------------------------------------

export async function clearSyncConfigData(): Promise<void> {
  await invoke('delete_sync_config');
}
