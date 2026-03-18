import { invoke } from '@tauri-apps/api/core';
import { encryptSyncConfig, decryptSyncConfig, DEFAULT_SYNC_CONFIG } from '@keykeykey/core/sync';
import type { SyncConfig } from '@keykeykey/core/sync';

// Re-export shared helpers from core for vault-context to use
export { createSyncEngineFromConfig, initSyncEngine } from '@keykeykey/core/sync';

// --- Sync config persistence via Tauri invoke commands ---

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function fromBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export async function loadSyncConfig(dek: Uint8Array): Promise<SyncConfig> {
  const b64 = await invoke<string | null>('load_sync_config');
  if (!b64) return DEFAULT_SYNC_CONFIG;
  try {
    return decryptSyncConfig(fromBase64(b64), dek);
  } catch {
    return DEFAULT_SYNC_CONFIG; // Corrupted config, reset to default
  }
}

export async function saveSyncConfig(config: SyncConfig, dek: Uint8Array): Promise<void> {
  const encrypted = encryptSyncConfig(config, dek);
  await invoke('save_sync_config', { dataB64: toBase64(encrypted) });
}

export async function clearSyncConfigData(): Promise<void> {
  await invoke('delete_sync_config');
}
