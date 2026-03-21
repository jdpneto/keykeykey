import type { PlatformStorage } from '@keykeykey/core/sync';
import * as FileSystem from 'expo-file-system';
import {
  saveVaultHeader,
  loadVaultHeader,
  saveEncryptedItem,
  loadAllEncryptedItems,
  deleteAllEncryptedItems,
  setVaultSetupComplete,
} from './storage';

const SYNC_CONFIG_PATH = `${FileSystem.documentDirectory}sync-config.bin`;

// ---------------------------------------------------------------------------
// Mobile PlatformStorage factory
// ---------------------------------------------------------------------------

export function createMobilePlatformStorage(): PlatformStorage {
  return {
    async loadSyncConfigFile(): Promise<Uint8Array | null> {
      const info = await FileSystem.getInfoAsync(SYNC_CONFIG_PATH);
      if (!info.exists) return null;
      const base64 = await FileSystem.readAsStringAsync(SYNC_CONFIG_PATH, {
        encoding: FileSystem.EncodingType.Base64,
      });
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return bytes;
    },
    async saveSyncConfigFile(data: Uint8Array): Promise<void> {
      // Chunked encoding to avoid max call stack with spread operator on large arrays
      const chunks: string[] = [];
      for (let i = 0; i < data.length; i++) {
        chunks.push(String.fromCharCode(data[i]));
      }
      const base64 = btoa(chunks.join(''));
      await FileSystem.writeAsStringAsync(SYNC_CONFIG_PATH, base64, {
        encoding: FileSystem.EncodingType.Base64,
      });
    },
    async deleteSyncConfigFile(): Promise<void> {
      try {
        await FileSystem.deleteAsync(SYNC_CONFIG_PATH, { idempotent: true });
      } catch {
        // File may not exist
      }
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
      await deleteAllEncryptedItems();
    },
    async saveVaultHeader(headerBase64: string): Promise<void> {
      await saveVaultHeader(headerBase64);
    },
    async loadVaultHeader(): Promise<string | null> {
      return loadVaultHeader();
    },
    async setVaultSetupComplete(complete: boolean): Promise<void> {
      await setVaultSetupComplete(complete);
    },
  };
}

// ---------------------------------------------------------------------------
// Sync config persistence (kept for clearSyncConfigData used by resetVault)
// ---------------------------------------------------------------------------

export async function clearSyncConfigData(): Promise<void> {
  try {
    await FileSystem.deleteAsync(SYNC_CONFIG_PATH, { idempotent: true });
  } catch {
    // File may not exist
  }
}
