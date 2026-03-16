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

export function encryptSyncConfig(config: SyncConfig, dek: Uint8Array): Uint8Array {
  const json = JSON.stringify(config);
  return encrypt(new TextEncoder().encode(json), dek);
}

export function decryptSyncConfig(data: Uint8Array, dek: Uint8Array): SyncConfig {
  const plainBytes = decrypt(data, dek);
  return JSON.parse(new TextDecoder().decode(plainBytes)) as SyncConfig;
}

export interface AdapterPlatformCallbacks {
  getAccessToken?: (refreshToken: string) => Promise<string>;
  getChromeAccessToken?: () => Promise<string>;
  icloudFs?: ICloudFs;
}

export function createAdapterFromConfig(
  config: SyncConfig,
  platform: AdapterPlatformCallbacks,
): ISyncAdapter | null {
  switch (config.provider) {
    case 'none':
      return null;
    case 'webdav':
      return new WebDavAdapter(config.webdav!);
    case 'google-drive': {
      const refreshToken = config.googleDrive!.refreshToken;
      const getToken =
        refreshToken === '__chrome_managed__' && platform.getChromeAccessToken
          ? platform.getChromeAccessToken
          : () => platform.getAccessToken!(refreshToken);
      return new GoogleDriveAdapter({ getAccessToken: getToken });
    }
    case 'icloud':
      return new ICloudAdapter({
        containerPath: config.icloud!.containerPath,
        fs: platform.icloudFs!,
      });
  }
}

export function getAvailableProviders(platform: string): SyncProvider[] {
  const providers: SyncProvider[] = ['none', 'webdav', 'google-drive'];
  if (APPLE_PLATFORMS.includes(platform)) {
    providers.push('icloud');
  }
  return providers;
}
