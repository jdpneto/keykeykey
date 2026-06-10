import { describe, it, expect } from 'vitest';
import { encryptSyncConfig, decryptSyncConfig } from './encryption.js';
import { createAdapterFromConfig, getAvailableProviders } from './factory.js';
import { DEFAULT_SYNC_CONFIG } from './schema.js';
import type { SyncConfig } from './schema.js';
import { randomBytes } from '@noble/hashes/utils';
import { SyncAdapterUnsupportedError } from '../core/errors.js';

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

  it('should throw if webdav config is missing credentials', () => {
    const config: SyncConfig = { provider: 'webdav' };
    expect(() => createAdapterFromConfig(config)).toThrow('webdav credentials');
  });

  it.each(['google-drive', 'dropbox', 'onedrive'] as const)(
    'should throw SyncAdapterUnsupportedError for disabled provider %s',
    (provider) => {
      const config: SyncConfig = { provider };
      expect(() => createAdapterFromConfig(config)).toThrow(SyncAdapterUnsupportedError);
    },
  );

  it('should throw even when the disabled provider has credentials configured', () => {
    const config: SyncConfig = {
      provider: 'google-drive',
      googleDrive: { refreshToken: 'tok', clientId: 'cid' },
    };
    expect(() => createAdapterFromConfig(config)).toThrow(SyncAdapterUnsupportedError);
  });
});

describe('getAvailableProviders', () => {
  it('should return exactly none and webdav', () => {
    expect(getAvailableProviders()).toEqual(['none', 'webdav']);
  });
});
