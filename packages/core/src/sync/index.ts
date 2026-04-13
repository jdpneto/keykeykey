/**
 * Sync module — BYOC (Bring Your Own Cloud) vault synchronization.
 * @module sync
 */

// Core
export { SyncEngine } from './core/sync-engine.js';
export type {
  SyncResult,
  SyncableStore,
  SyncEngineOptions,
  VaultMismatchInfo,
} from './core/sync-engine.js';
export type { ISyncAdapter, SyncManifest, SyncItemMeta, TombstoneEntry } from './core/types.js';
export { mergeManifestsV2, mergeItemSets } from './core/merge.js';
export type { MergeResult } from './core/merge.js';
export { garbageCollectTombstones } from './core/tombstone.js';
export { SyncAuthError, SyncAdapterUnsupportedError } from './core/errors.js';

// Adapters
export { MemoryAdapter } from './adapters/memory-adapter.js';
export { WebDavAdapter } from './adapters/webdav-adapter.js';
export type { WebDavAdapterOptions } from './adapters/webdav-adapter.js';
export { GoogleDriveAdapter } from './adapters/google-drive-adapter.js';
export type { GoogleDriveAdapterOptions } from './adapters/google-drive-adapter.js';
export { DropboxAdapter } from './adapters/dropbox-adapter.js';
export type { DropboxAdapterOptions } from './adapters/dropbox-adapter.js';
export { OneDriveAdapter } from './adapters/onedrive-adapter.js';
export type { OneDriveAdapterOptions } from './adapters/onedrive-adapter.js';

// OAuth
export { generateCodeVerifier, generateCodeChallenge, generateState } from './oauth/pkce.js';
export { OAuthError } from './oauth/oauth-client.js';
export type {
  OAuthEndpoints,
  TokenResponse,
  RefreshParams,
  RefreshResponse,
} from './oauth/oauth-client.js';
export { createCachedTokenProvider } from './oauth/cached-token-provider.js';
export { GOOGLE_ENDPOINTS, GoogleOAuthError } from './oauth/google.js';
export {
  buildAuthUrl as buildGoogleAuthUrl,
  exchangeAuthCode as exchangeGoogleAuthCode,
  refreshAccessToken as refreshGoogleAccessToken,
  revokeToken as revokeGoogleToken,
  createCachedTokenProvider as createGoogleTokenProvider,
  // Also re-export under original names for backward compatibility
  buildAuthUrl,
  exchangeAuthCode,
  refreshAccessToken,
  revokeToken,
} from './oauth/google.js';
export type { BuildAuthUrlParams, ExchangeAuthCodeParams } from './oauth/google.js';
export {
  DROPBOX_ENDPOINTS,
  buildDropboxAuthUrl,
  exchangeDropboxAuthCode,
  createDropboxTokenProvider,
  revokeDropboxToken,
} from './oauth/dropbox.js';
export {
  ONEDRIVE_ENDPOINTS,
  ONEDRIVE_SCOPE,
  buildOneDriveAuthUrl,
  exchangeOneDriveAuthCode,
  createOneDriveTokenProvider,
} from './oauth/onedrive.js';

// Config
export type { SyncConfig, SyncProvider } from './config/schema.js';
export { DEFAULT_SYNC_CONFIG } from './config/schema.js';
export { encryptSyncConfig, decryptSyncConfig } from './config/encryption.js';
export {
  createAdapterFromConfig,
  createSyncEngineFromConfig,
  initSyncEngine,
  deriveMEKFromAdapter,
  getAvailableProviders,
} from './config/factory.js';
export type { AdapterOverrides } from './config/factory.js';

// Lifecycle
export { SyncLifecycle } from './lifecycle/sync-lifecycle.js';
export type { PlatformStorage, StoredItem } from './lifecycle/platform-storage.js';
export type {
  SyncLifecycleCallbacks,
  SubscribableSyncStore,
} from './lifecycle/sync-lifecycle.js';
export { restoreFromCloud, checkCloudConflict } from './lifecycle/restore.js';
export type {
  RestoreFromCloudResult,
  RestoreProgressEvent,
  CloudConflictResult,
} from './lifecycle/restore.js';

// Blob
export {
  PREAMBLE_SIZE,
  encryptVaultBlob,
  decryptVaultBlob,
  readPreambleFromBlob,
  VaultBlobSchema,
} from './blob/vault-blob.js';
export type { VaultBlob } from './blob/vault-blob.js';
export { generateSyncSalt, deriveMEK, validateArgon2Params } from './blob/mek.js';

// Utilities
export { connectSyncEngine } from './connect.js';
export { deleteCloudVault } from './delete-cloud-vault.js';
export type { DeleteCloudVaultResult } from './delete-cloud-vault.js';
