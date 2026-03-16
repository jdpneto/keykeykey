import { encryptSyncConfig, decryptSyncConfig, DEFAULT_SYNC_CONFIG } from '@keykeykey/core/sync';
import type { SyncConfig } from '@keykeykey/core/sync';

// Re-export shared helpers from core for vault-context to use
export { createSyncEngineFromConfig, initSyncEngine } from '@keykeykey/core/sync';

// Tauri fs functions for sync config persistence
async function saveSyncConfigFile(data: Uint8Array): Promise<void> {
  const { writeFile, BaseDirectory } = await import('@tauri-apps/plugin-fs');
  await writeFile('sync-config.bin', data, { baseDir: BaseDirectory.AppData });
}

async function loadSyncConfigFile(): Promise<Uint8Array | null> {
  try {
    const { readFile, BaseDirectory } = await import('@tauri-apps/plugin-fs');
    return await readFile('sync-config.bin', { baseDir: BaseDirectory.AppData });
  } catch {
    return null; // File doesn't exist
  }
}

async function deleteSyncConfigFile(): Promise<void> {
  try {
    const { remove, BaseDirectory } = await import('@tauri-apps/plugin-fs');
    await remove('sync-config.bin', { baseDir: BaseDirectory.AppData });
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
    return DEFAULT_SYNC_CONFIG; // Corrupted config, reset to default
  }
}

export async function saveSyncConfig(config: SyncConfig, dek: Uint8Array): Promise<void> {
  const encrypted = encryptSyncConfig(config, dek);
  await saveSyncConfigFile(encrypted);
}

export async function clearSyncConfigData(): Promise<void> {
  await deleteSyncConfigFile();
}
