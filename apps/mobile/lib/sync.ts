import {
  SyncEngine,
  connectSyncEngine,
  createAdapterFromConfig,
  encryptSyncConfig,
  decryptSyncConfig,
  DEFAULT_SYNC_CONFIG,
} from '@keykeykey/core/sync';
import type { SyncConfig, SyncableStore, AdapterPlatformCallbacks } from '@keykeykey/core/sync';
import * as FileSystem from 'expo-file-system';

const SYNC_CONFIG_PATH = `${FileSystem.documentDirectory}sync-config.bin`;

async function saveSyncConfigFile(data: Uint8Array): Promise<void> {
  const base64 = btoa(String.fromCharCode(...data));
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

export function createSyncEngineMobile(
  config: SyncConfig,
  store: SyncableStore,
  platformCallbacks: AdapterPlatformCallbacks,
  onVaultReplaced: (info: { localVaultId: string; remoteVaultId: string }) => void,
): SyncEngine | null {
  const adapter = createAdapterFromConfig(config, platformCallbacks);
  if (!adapter) return null;
  return new SyncEngine({ adapter, store, onVaultReplaced });
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
