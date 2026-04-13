import { describe, it, expect } from 'vitest';
import { encryptSyncConfig, decryptSyncConfig } from './encryption.js';
import { createAdapterFromConfig, getAvailableProviders } from './factory.js';
import { DEFAULT_SYNC_CONFIG } from './schema.js';
import type { SyncConfig } from './schema.js';
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
      googleDrive: { refreshToken: 'token-123', clientId: 'cid-456' },
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

  it('should round-trip encrypt/decrypt a WebDAV config with masterPassword', () => {
    const config: SyncConfig = {
      provider: 'webdav',
      masterPassword: 'my-secret-password',
      webdav: { url: 'https://dav.example.com', username: 'user', password: 'pass' },
    };
    const encrypted = encryptSyncConfig(config, dek);
    const decrypted = decryptSyncConfig(encrypted, dek);
    expect(decrypted).toEqual(config);
    expect(decrypted.masterPassword).toBe('my-secret-password');
  });

  it('should round-trip encrypt/decrypt a Dropbox config', () => {
    const config: SyncConfig = {
      provider: 'dropbox',
      masterPassword: 'secret',
      dropbox: { refreshToken: 'dbx-token', clientId: 'dbx-client-id' },
    };
    const encrypted = encryptSyncConfig(config, dek);
    const decrypted = decryptSyncConfig(encrypted, dek);
    expect(decrypted).toEqual(config);
  });

  it('should round-trip encrypt/decrypt a OneDrive config', () => {
    const config: SyncConfig = {
      provider: 'onedrive',
      masterPassword: 'secret',
      onedrive: { refreshToken: 'od-token', clientId: 'od-client-id' },
    };
    const encrypted = encryptSyncConfig(config, dek);
    const decrypted = decryptSyncConfig(encrypted, dek);
    expect(decrypted).toEqual(config);
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
    const adapter = createAdapterFromConfig({ provider: 'none' });
    expect(adapter).toBeNull();
  });

  it('should return WebDavAdapter for webdav provider', () => {
    const config: SyncConfig = {
      provider: 'webdav',
      webdav: { url: 'https://dav.example.com', username: 'u', password: 'p' },
    };
    const adapter = createAdapterFromConfig(config);
    expect(adapter).not.toBeNull();
    expect(adapter!.constructor.name).toBe('WebDavAdapter');
  });

  it('should return GoogleDriveAdapter for google-drive provider', () => {
    const config: SyncConfig = {
      provider: 'google-drive',
      googleDrive: { refreshToken: 'tok', clientId: 'cid' },
    };
    const adapter = createAdapterFromConfig(config);
    expect(adapter).not.toBeNull();
    expect(adapter!.constructor.name).toBe('GoogleDriveAdapter');
  });

  it('should throw if webdav config is missing credentials', () => {
    const config: SyncConfig = { provider: 'webdav' };
    expect(() => createAdapterFromConfig(config)).toThrow('webdav credentials');
  });

  it('should throw if google-drive config is missing googleDrive settings', () => {
    const config: SyncConfig = { provider: 'google-drive' };
    expect(() => createAdapterFromConfig(config)).toThrow('googleDrive settings');
  });

  it('should create adapter without platform callbacks for google-drive', () => {
    const config: SyncConfig = {
      provider: 'google-drive',
      googleDrive: { refreshToken: 'tok', clientId: 'cid' },
    };
    const adapter = createAdapterFromConfig(config);
    expect(adapter).not.toBeNull();
  });

  it('should return DropboxAdapter for dropbox provider', () => {
    const config: SyncConfig = {
      provider: 'dropbox',
      dropbox: { refreshToken: 'dbx-tok', clientId: 'dbx-cid' },
    };
    const adapter = createAdapterFromConfig(config);
    expect(adapter).not.toBeNull();
    expect(adapter!.constructor.name).toBe('DropboxAdapter');
  });

  it('should throw if dropbox config is missing dropbox settings', () => {
    const config: SyncConfig = { provider: 'dropbox' };
    expect(() => createAdapterFromConfig(config)).toThrow('dropbox settings');
  });

  it('should return OneDriveAdapter for onedrive provider', () => {
    const config: SyncConfig = {
      provider: 'onedrive',
      onedrive: { refreshToken: 'od-tok', clientId: 'od-cid' },
    };
    const adapter = createAdapterFromConfig(config);
    expect(adapter).not.toBeNull();
    expect(adapter!.constructor.name).toBe('OneDriveAdapter');
  });

  it('should throw if onedrive config is missing onedrive settings', () => {
    const config: SyncConfig = { provider: 'onedrive' };
    expect(() => createAdapterFromConfig(config)).toThrow('onedrive settings');
  });
});

describe('getAvailableProviders', () => {
  it('should return none, webdav, google-drive, dropbox, onedrive', () => {
    const providers = getAvailableProviders();
    expect(providers).toContain('none');
    expect(providers).toContain('webdav');
    expect(providers).toContain('google-drive');
    expect(providers).toContain('dropbox');
    expect(providers).toContain('onedrive');
    expect(providers).not.toContain('icloud');
  });

  it('should return exactly five providers', () => {
    const providers = getAvailableProviders();
    expect(providers).toHaveLength(5);
  });
});
