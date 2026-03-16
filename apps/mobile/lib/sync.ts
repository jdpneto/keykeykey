import { encryptSyncConfig, decryptSyncConfig, DEFAULT_SYNC_CONFIG } from '@keykeykey/core/sync';
import type { SyncConfig } from '@keykeykey/core/sync';
import * as FileSystem from 'expo-file-system';

// Re-export shared helpers from core for vault-context to use
export { createSyncEngineFromConfig, initSyncEngine } from '@keykeykey/core/sync';

const SYNC_CONFIG_PATH = `${FileSystem.documentDirectory}sync-config.bin`;

async function saveSyncConfigFile(data: Uint8Array): Promise<void> {
  // Chunked encoding to avoid max call stack with spread operator on large arrays
  const chunks: string[] = [];
  for (let i = 0; i < data.length; i++) {
    chunks.push(String.fromCharCode(data[i]));
  }
  const base64 = btoa(chunks.join(''));
  await FileSystem.writeAsStringAsync(SYNC_CONFIG_PATH, base64, {
    encoding: FileSystem.EncodingType.Base64,
  });
}

async function loadSyncConfigFile(): Promise<Uint8Array | null> {
  const info = await FileSystem.getInfoAsync(SYNC_CONFIG_PATH);
  if (!info.exists) return null;
  const base64 = await FileSystem.readAsStringAsync(SYNC_CONFIG_PATH, {
    encoding: FileSystem.EncodingType.Base64,
  });
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function deleteSyncConfigFile(): Promise<void> {
  try {
    await FileSystem.deleteAsync(SYNC_CONFIG_PATH, { idempotent: true });
  } catch {
    // File may not exist
  }
}

export async function loadSyncConfig(dek: Uint8Array): Promise<SyncConfig> {
  const data = await loadSyncConfigFile();
  if (!data) return DEFAULT_SYNC_CONFIG;
  try {
    return decryptSyncConfig(data, dek);
  } catch {
    return DEFAULT_SYNC_CONFIG;
  }
}

export async function saveSyncConfig(config: SyncConfig, dek: Uint8Array): Promise<void> {
  const encrypted = encryptSyncConfig(config, dek);
  await saveSyncConfigFile(encrypted);
}

export async function clearSyncConfigData(): Promise<void> {
  await deleteSyncConfigFile();
}
