import { describe, it, expect } from 'vitest';
import { ENABLED_SYNC_PROVIDERS, isSyncProviderEnabled } from './enabled-providers.js';

describe('ENABLED_SYNC_PROVIDERS', () => {
  it('contains exactly none and webdav', () => {
    expect(ENABLED_SYNC_PROVIDERS).toEqual(['none', 'webdav']);
  });
});

describe('isSyncProviderEnabled', () => {
  it('returns true for none and webdav', () => {
    expect(isSyncProviderEnabled('none')).toBe(true);
    expect(isSyncProviderEnabled('webdav')).toBe(true);
  });

  it('returns false for the OAuth providers', () => {
    expect(isSyncProviderEnabled('google-drive')).toBe(false);
    expect(isSyncProviderEnabled('dropbox')).toBe(false);
    expect(isSyncProviderEnabled('onedrive')).toBe(false);
  });
});
