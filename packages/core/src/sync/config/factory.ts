import type { Argon2Params } from '../../crypto/constants.js';
import { connectSyncEngine } from '../connect.js';
import { SyncEngine } from '../sync-engine.js';
import type { SyncableStore, VaultMismatchInfo } from '../sync-engine.js';
import { WebDavAdapter } from '../adapters/webdav-adapter.js';
import { GoogleDriveAdapter } from '../adapters/google-drive-adapter.js';
import { createCachedTokenProvider } from '../oauth/google.js';
import { DropboxAdapter } from '../adapters/dropbox-adapter.js';
import { createDropboxTokenProvider } from '../oauth/dropbox.js';
import { OneDriveAdapter } from '../adapters/onedrive-adapter.js';
import { createOneDriveTokenProvider } from '../oauth/onedrive.js';
import type { ISyncAdapter } from '../core/types.js';
import {
  readPreambleFromBlob,
  PREAMBLE_SIZE,
} from '../blob/vault-blob.js';
import { deriveMEK, generateSyncSalt, validateArgon2Params } from '../blob/mek.js';
import type { SyncConfig, SyncProvider } from './schema.js';

/**
 * Optional overrides for adapter creation (e.g., chrome.identity token provider).
 */
export interface AdapterOverrides {
  /** If provided, used instead of the default refresh-token-based provider for Google Drive. */
  googleDriveTokenProvider?: () => Promise<string>;
}

/**
 * Create a sync adapter instance from a persisted SyncConfig.
 *
 * Returns `null` for provider `'none'`. For all other providers, the required
 * config fields are validated before constructing the adapter.
 *
 * @param config - The sync configuration specifying the provider and credentials
 * @returns A configured ISyncAdapter, or null if sync is disabled
 * @throws {Error} If required config fields are missing
 */
export function createAdapterFromConfig(
  config: SyncConfig,
  overrides?: AdapterOverrides,
): ISyncAdapter | null {
  switch (config.provider) {
    case 'none':
      return null;
    case 'webdav':
      if (!config.webdav) {
        throw new Error('WebDAV config requires webdav credentials');
      }
      return new WebDavAdapter(config.webdav);
    case 'google-drive': {
      if (!config.googleDrive) {
        throw new Error('Google Drive config requires googleDrive settings');
      }
      if (overrides?.googleDriveTokenProvider) {
        return new GoogleDriveAdapter({ getAccessToken: overrides.googleDriveTokenProvider });
      }
      const { refreshToken, clientId, clientSecret } = config.googleDrive;
      return new GoogleDriveAdapter({
        getAccessToken: createCachedTokenProvider(refreshToken, clientId, clientSecret),
      });
    }
    case 'dropbox': {
      if (!config.dropbox) throw new Error('Dropbox config requires dropbox settings');
      const { refreshToken, clientId } = config.dropbox;
      return new DropboxAdapter({
        getAccessToken: createDropboxTokenProvider(refreshToken, clientId),
      });
    }
    case 'onedrive': {
      if (!config.onedrive) throw new Error('OneDrive config requires onedrive settings');
      const { refreshToken, clientId } = config.onedrive;
      return new OneDriveAdapter({
        getAccessToken: createOneDriveTokenProvider(refreshToken, clientId),
      });
    }
  }
}

/**
 * Create a SyncEngine from a SyncConfig, or return null if provider is 'none'.
 *
 * This is a convenience wrapper that combines createAdapterFromConfig + new SyncEngine.
 */
export function createSyncEngineFromConfig(
  config: SyncConfig,
  store: SyncableStore,
  mek: Uint8Array,
  syncSalt: Uint8Array,
  vaultHeaderBytes: Uint8Array,
  argon2Params: Argon2Params,
  onVaultMismatch?: (info: VaultMismatchInfo) => void,
  overrides?: AdapterOverrides,
): SyncEngine | null {
  const adapter = createAdapterFromConfig(config, overrides);
  if (!adapter) return null;
  return new SyncEngine({
    adapter,
    store,
    mek,
    syncSalt,
    vaultHeaderBytes,
    argon2Params,
    onVaultMismatch,
  });
}

/**
 * Fire-and-forget initial sync and wire auto-sync on item changes.
 *
 * @param engine - The SyncEngine instance
 * @param store - A Zustand-compatible store with subscribe (for connectSyncEngine)
 * @returns Disconnect function to unsubscribe from item changes
 */
export function initSyncEngine(
  engine: SyncEngine,
  store: Parameters<typeof connectSyncEngine>[0],
): () => void {
  engine.sync().catch((err) => {
    console.warn('Initial sync failed:', err instanceof Error ? err.message : err);
  });
  return connectSyncEngine(store, engine);
}

/**
 * Read the sync salt from the remote vault blob preamble, or generate a fresh one.
 * Then derive the MEK from the master password using the determined salt and params.
 *
 * This is the common setup logic needed before creating a SyncEngine.
 */
export async function deriveMEKFromAdapter(
  adapter: ISyncAdapter | null,
  masterPassword: string,
  fallbackArgon2Params: Argon2Params,
): Promise<{ mek: Uint8Array; syncSalt: Uint8Array; mekArgon2Params: Argon2Params }> {
  let syncSalt: Uint8Array;
  let mekArgon2Params = fallbackArgon2Params;

  if (adapter) {
    try {
      const remoteBlob = await adapter.readVaultBlob();
      if (remoteBlob && remoteBlob.length >= PREAMBLE_SIZE) {
        const preamble = readPreambleFromBlob(remoteBlob);
        validateArgon2Params(preamble.argon2Params);
        syncSalt = preamble.syncSalt;
        mekArgon2Params = preamble.argon2Params;
      } else {
        syncSalt = generateSyncSalt();
      }
    } catch {
      syncSalt = generateSyncSalt();
    }
  } else {
    syncSalt = generateSyncSalt();
  }

  const mek = await deriveMEK(masterPassword, syncSalt, mekArgon2Params);
  return { mek, syncSalt, mekArgon2Params };
}

export function getAvailableProviders(): SyncProvider[] {
  return ['none', 'webdav', 'google-drive', 'dropbox', 'onedrive'];
}
