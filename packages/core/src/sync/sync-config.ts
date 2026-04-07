import { z } from 'zod';
import { encrypt, decrypt } from '../crypto/encryption.js';
import type { Argon2Params } from '../crypto/constants.js';
import { connectSyncEngine } from './connect.js';
import { SyncEngine } from './sync-engine.js';
import type { SyncableStore, VaultMismatchInfo } from './sync-engine.js';
import { WebDavAdapter } from './webdav-adapter.js';
import { GoogleDriveAdapter } from './google-drive-adapter.js';
import { createCachedTokenProvider } from './google-oauth.js';
import { DropboxAdapter } from './dropbox-adapter.js';
import { createDropboxTokenProvider } from './dropbox-oauth.js';
import { OneDriveAdapter } from './onedrive-adapter.js';
import { createOneDriveTokenProvider } from './onedrive-oauth.js';
import type { ISyncAdapter } from './types.js';
import {
  deriveMEK,
  generateSyncSalt,
  readPreambleFromBlob,
  validateArgon2Params,
  PREAMBLE_SIZE,
} from './vault-blob.js';

export type SyncProvider = 'none' | 'webdav' | 'google-drive' | 'dropbox' | 'onedrive';

const SyncConfigSchema = z.object({
  provider: z.enum(['none', 'webdav', 'google-drive', 'dropbox', 'onedrive']),
  masterPassword: z.string().optional(),
  webdav: z.object({ url: z.string(), username: z.string(), password: z.string() }).optional(),
  googleDrive: z
    .object({
      refreshToken: z.string(),
      clientId: z.string(),
      clientSecret: z.string().optional(),
    })
    .optional(),
  dropbox: z.object({ refreshToken: z.string(), clientId: z.string() }).optional(),
  onedrive: z.object({ refreshToken: z.string(), clientId: z.string() }).optional(),
});

export type SyncConfig = z.infer<typeof SyncConfigSchema>;

export const DEFAULT_SYNC_CONFIG: SyncConfig = { provider: 'none' };

/**
 * Encrypt a SyncConfig for persistent storage using XChaCha20-Poly1305.
 *
 * The config is JSON-serialized then encrypted with the provided DEK.
 * A random 24-byte nonce is prepended to the output, so encrypting the same
 * config twice produces different ciphertext.
 *
 * @param config - The sync configuration to encrypt
 * @param dek - 32-byte data encryption key
 * @returns Encrypted bytes: [24B nonce][ciphertext][16B Poly1305 tag]
 */
export function encryptSyncConfig(config: SyncConfig, dek: Uint8Array): Uint8Array {
  const json = JSON.stringify(config);
  return encrypt(new TextEncoder().encode(json), dek);
}

/**
 * Decrypt a SyncConfig previously encrypted with {@link encryptSyncConfig}.
 *
 * @param data - Encrypted bytes produced by encryptSyncConfig
 * @param dek - 32-byte data encryption key (must match the encryption key)
 * @returns The decrypted SyncConfig
 * @throws {Error} If the ciphertext is tampered or the wrong key is used
 */
export function decryptSyncConfig(data: Uint8Array, dek: Uint8Array): SyncConfig {
  const plainBytes = decrypt(data, dek);
  const parsed: unknown = JSON.parse(new TextDecoder().decode(plainBytes));
  return SyncConfigSchema.parse(parsed);
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
/**
 * Optional overrides for adapter creation (e.g., chrome.identity token provider).
 */
export interface AdapterOverrides {
  /** If provided, used instead of the default refresh-token-based provider for Google Drive. */
  googleDriveTokenProvider?: () => Promise<string>;
}

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
