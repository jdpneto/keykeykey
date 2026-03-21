import { z } from 'zod';
import { encrypt, decrypt } from '../crypto/encryption.js';
import type { Argon2Params } from '../crypto/constants.js';
import { connectSyncEngine } from './connect.js';
import { SyncEngine } from './sync-engine.js';
import type { SyncableStore, VaultMismatchInfo } from './sync-engine.js';
import { WebDavAdapter } from './webdav-adapter.js';
import { GoogleDriveAdapter } from './google-drive-adapter.js';
import { ICloudAdapter } from './icloud-adapter.js';
import type { ISyncAdapter } from './types.js';
import type { ICloudFs } from './icloud-adapter.js';
import {
  deriveMEK,
  generateSyncSalt,
  readPreambleFromBlob,
  validateArgon2Params,
  PREAMBLE_SIZE,
} from './vault-blob.js';

export type SyncProvider = 'none' | 'webdav' | 'google-drive' | 'icloud';

const SyncConfigSchema = z.object({
  provider: z.enum(['none', 'webdav', 'google-drive', 'icloud']),
  masterPassword: z.string().optional(),
  webdav: z.object({ url: z.string(), username: z.string(), password: z.string() }).optional(),
  googleDrive: z.object({ refreshToken: z.string() }).optional(),
  icloud: z.object({ containerPath: z.string() }).optional(),
});

export type SyncConfig = z.infer<typeof SyncConfigSchema>;

export const DEFAULT_SYNC_CONFIG: SyncConfig = { provider: 'none' };

const APPLE_PLATFORMS = ['ios', 'macos', 'safari'];

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

export interface AdapterPlatformCallbacks {
  getAccessToken?: (refreshToken: string) => Promise<string>;
  getChromeAccessToken?: () => Promise<string>;
  icloudFs?: ICloudFs;
}

/**
 * Create a sync adapter instance from a persisted SyncConfig.
 *
 * Returns `null` for provider `'none'`. For all other providers, the required
 * config fields and platform callbacks are validated before constructing the
 * adapter.
 *
 * @param config - The sync configuration specifying the provider and credentials
 * @param platform - Platform-specific callbacks (OAuth token helpers, iCloud FS)
 * @returns A configured ISyncAdapter, or null if sync is disabled
 * @throws {Error} If required config fields or platform callbacks are missing
 */
export function createAdapterFromConfig(
  config: SyncConfig,
  platform: AdapterPlatformCallbacks,
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
      const refreshToken = config.googleDrive.refreshToken;
      const useChromeManaged =
        refreshToken === '__chrome_managed__' && platform.getChromeAccessToken;
      if (!useChromeManaged && !platform.getAccessToken) {
        throw new Error(
          'Google Drive config requires either getAccessToken or getChromeAccessToken callback',
        );
      }
      const getToken = useChromeManaged
        ? platform.getChromeAccessToken!
        : () => platform.getAccessToken!(refreshToken);
      return new GoogleDriveAdapter({ getAccessToken: getToken });
    }
    case 'icloud': {
      if (!config.icloud) {
        throw new Error('iCloud config requires icloud settings');
      }
      if (!platform.icloudFs) {
        throw new Error('iCloud config requires icloudFs platform callback');
      }
      return new ICloudAdapter({
        containerPath: config.icloud.containerPath,
        fs: platform.icloudFs,
      });
    }
  }
}

/**
 * Return the list of sync providers available on a given platform.
 *
 * iCloud is only available on Apple platforms (ios, macos, safari).
 * All other providers (none, webdav, google-drive) are universally available.
 *
 * @param platform - Platform identifier (e.g. 'ios', 'macos', 'android', 'windows', 'chrome')
 * @returns Array of available SyncProvider values
 */
/**
 * Create a SyncEngine from a SyncConfig, or return null if provider is 'none'.
 *
 * This is a convenience wrapper that combines createAdapterFromConfig + new SyncEngine.
 */
export function createSyncEngineFromConfig(
  config: SyncConfig,
  store: SyncableStore,
  platformCallbacks: AdapterPlatformCallbacks,
  mek: Uint8Array,
  syncSalt: Uint8Array,
  vaultHeaderBytes: Uint8Array,
  argon2Params: Argon2Params,
  onVaultMismatch?: (info: VaultMismatchInfo) => void,
): SyncEngine | null {
  const adapter = createAdapterFromConfig(config, platformCallbacks);
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

export function getAvailableProviders(platform: string): SyncProvider[] {
  const providers: SyncProvider[] = ['none', 'webdav', 'google-drive'];
  if (APPLE_PLATFORMS.includes(platform)) {
    providers.push('icloud');
  }
  return providers;
}
