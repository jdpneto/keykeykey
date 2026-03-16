import { encrypt, decrypt } from '../crypto/encryption.js';
import { WebDavAdapter } from './webdav-adapter.js';
import { GoogleDriveAdapter } from './google-drive-adapter.js';
import { ICloudAdapter } from './icloud-adapter.js';
import type { ISyncAdapter } from './types.js';
import type { ICloudFs } from './icloud-adapter.js';

export type SyncProvider = 'none' | 'webdav' | 'google-drive' | 'icloud';

export interface SyncConfig {
  provider: SyncProvider;
  webdav?: { url: string; username: string; password: string };
  googleDrive?: { refreshToken: string };
  icloud?: { containerPath: string };
}

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
  return JSON.parse(new TextDecoder().decode(plainBytes)) as SyncConfig;
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
export function getAvailableProviders(platform: string): SyncProvider[] {
  const providers: SyncProvider[] = ['none', 'webdav', 'google-drive'];
  if (APPLE_PLATFORMS.includes(platform)) {
    providers.push('icloud');
  }
  return providers;
}
