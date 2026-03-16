import {
  SyncEngine,
  connectSyncEngine,
  createAdapterFromConfig,
  encryptSyncConfig,
  decryptSyncConfig,
  DEFAULT_SYNC_CONFIG,
} from '@keykeykey/core/sync';
import type { SyncConfig, SyncableStore, AdapterPlatformCallbacks } from '@keykeykey/core/sync';

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

export function createSyncEngine(
  config: SyncConfig,
  store: SyncableStore,
  platformCallbacks: AdapterPlatformCallbacks,
  onVaultReplaced: (info: { localVaultId: string; remoteVaultId: string }) => void,
): SyncEngine | null {
  const adapter = createAdapterFromConfig(config, platformCallbacks);
  if (!adapter) return null;

  return new SyncEngine({
    adapter,
    store,
    onVaultReplaced,
  });
}

/**
 * Kick off initial sync and wire auto-sync on item changes.
 *
 * @param engine - The SyncEngine instance
 * @param store - The Zustand vault store (must have `subscribe` for connectSyncEngine)
 * @returns Disconnect function to unsubscribe from item changes
 */
export async function startSync(
  engine: SyncEngine,
  store: {
    getState: () => { status: string; items: unknown[] };
    subscribe: (
      listener: (
        state: { status: string; items: unknown[] },
        prevState: { status: string; items: unknown[] },
      ) => void,
    ) => () => void;
  },
): Promise<() => void> {
  // Fire-and-forget initial sync — don't block unlock
  engine.sync().catch((err) => {
    console.warn('Initial sync failed:', err instanceof Error ? err.message : err);
  });

  // Wire auto-sync on item changes
  return connectSyncEngine(store, engine);
}
