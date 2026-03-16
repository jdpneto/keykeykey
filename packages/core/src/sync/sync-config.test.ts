import { describe, it, expect } from 'vitest';
import {
  encryptSyncConfig,
  decryptSyncConfig,
  createAdapterFromConfig,
  getAvailableProviders,
  DEFAULT_SYNC_CONFIG,
} from './sync-config.js';
import type { SyncConfig } from './sync-config.js';
import { randomBytes } from '@noble/hashes/utils';

describe('SyncConfig encryption', () => {
  const dek = randomBytes(32);

  it('should round-trip encrypt/decrypt a WebDAV config', () => {
    const config: SyncConfig = {
      provider: 'webdav',
      webdav: { url: 'https://dav.example.com', username: 'user', password: 'pass' },
    };
    const encrypted = encryptSyncConfig(config, dek);
    const decrypted = decryptSyncConfig(encrypted, dek);
    expect(decrypted).toEqual(config);
  });

  it('should round-trip encrypt/decrypt a Google Drive config', () => {
    const config: SyncConfig = {
      provider: 'google-drive',
      googleDrive: { refreshToken: 'token-123' },
    };
    const encrypted = encryptSyncConfig(config, dek);
    const decrypted = decryptSyncConfig(encrypted, dek);
    expect(decrypted).toEqual(config);
  });

  it('should round-trip encrypt/decrypt a none config', () => {
    const encrypted = encryptSyncConfig(DEFAULT_SYNC_CONFIG, dek);
    const decrypted = decryptSyncConfig(encrypted, dek);
    expect(decrypted).toEqual(DEFAULT_SYNC_CONFIG);
  });

  it('should produce different ciphertext for same config (random nonce)', () => {
    const config: SyncConfig = { provider: 'none' };
    const a = encryptSyncConfig(config, dek);
    const b = encryptSyncConfig(config, dek);
    expect(a).not.toEqual(b);
  });

  it('should throw on tampered ciphertext', () => {
    const config: SyncConfig = { provider: 'none' };
    const encrypted = encryptSyncConfig(config, dek);
    encrypted[0] ^= 0xff; // tamper
    expect(() => decryptSyncConfig(encrypted, dek)).toThrow();
  });
});

describe('createAdapterFromConfig', () => {
  it('should return null for provider none', () => {
    const adapter = createAdapterFromConfig({ provider: 'none' }, {});
    expect(adapter).toBeNull();
  });

  it('should return WebDavAdapter for webdav provider', () => {
    const config: SyncConfig = {
      provider: 'webdav',
      webdav: { url: 'https://dav.example.com', username: 'u', password: 'p' },
    };
    const adapter = createAdapterFromConfig(config, {});
    expect(adapter).not.toBeNull();
    expect(adapter!.constructor.name).toBe('WebDavAdapter');
  });

  it('should return GoogleDriveAdapter for google-drive provider', () => {
    const config: SyncConfig = {
      provider: 'google-drive',
      googleDrive: { refreshToken: 'tok' },
    };
    const getAccessToken = async (_rt: string) => 'access-token';
    const adapter = createAdapterFromConfig(config, { getAccessToken });
    expect(adapter).not.toBeNull();
    expect(adapter!.constructor.name).toBe('GoogleDriveAdapter');
  });

  it('should use getChromeAccessToken for __chrome_managed__ sentinel', () => {
    const config: SyncConfig = {
      provider: 'google-drive',
      googleDrive: { refreshToken: '__chrome_managed__' },
    };
    const getChromeAccessToken = async () => 'chrome-token';
    const adapter = createAdapterFromConfig(config, { getChromeAccessToken });
    expect(adapter).not.toBeNull();
  });

  it('should return ICloudAdapter for icloud provider', () => {
    const config: SyncConfig = {
      provider: 'icloud',
      icloud: { containerPath: '/icloud/keykeykey' },
    };
    const mockFs = {
      readFile: async () => '',
      writeFile: async () => {},
      deleteFile: async () => {},
      listFiles: async () => [],
      exists: async () => false,
      mkdir: async () => {},
    };
    const adapter = createAdapterFromConfig(config, { icloudFs: mockFs });
    expect(adapter).not.toBeNull();
    expect(adapter!.constructor.name).toBe('ICloudAdapter');
  });
});

describe('getAvailableProviders', () => {
  it('should always include none, webdav, google-drive', () => {
    const providers = getAvailableProviders('windows');
    expect(providers).toContain('none');
    expect(providers).toContain('webdav');
    expect(providers).toContain('google-drive');
    expect(providers).not.toContain('icloud');
  });

  it('should include icloud on ios', () => {
    expect(getAvailableProviders('ios')).toContain('icloud');
  });

  it('should include icloud on macos', () => {
    expect(getAvailableProviders('macos')).toContain('icloud');
  });

  it('should include icloud on safari', () => {
    expect(getAvailableProviders('safari')).toContain('icloud');
  });

  it('should not include icloud on android', () => {
    expect(getAvailableProviders('android')).not.toContain('icloud');
  });

  it('should not include icloud on chrome', () => {
    expect(getAvailableProviders('chrome')).not.toContain('icloud');
  });
});
