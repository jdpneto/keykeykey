/**
 * Sync adapter interface and implementations for BYOC (Bring Your Own Cloud) sync.
 *
 * @module sync
 */

export type { ISyncAdapter, SyncManifest, SyncItemMeta, TombstoneEntry } from './core/types.js';

export { MemoryAdapter } from './adapters/memory-adapter.js';
export { garbageCollectTombstones } from './core/tombstone.js';
export { SyncAuthError, SyncAdapterUnsupportedError } from './core/errors.js';
export { mergeManifestsV2, mergeItemSets } from './core/merge.js';
export type { MergeResult } from './core/merge.js';
export { SyncEngine } from './sync-engine.js';
export type {
  SyncResult,
  SyncableStore,
  SyncEngineOptions,
  VaultMismatchInfo,
} from './sync-engine.js';
export { connectSyncEngine } from './connect.js';
export { WebDavAdapter } from './adapters/webdav-adapter.js';
export type { WebDavAdapterOptions } from './adapters/webdav-adapter.js';
export { GoogleDriveAdapter } from './adapters/google-drive-adapter.js';
export type { GoogleDriveAdapterOptions } from './adapters/google-drive-adapter.js';
export { DropboxAdapter } from './adapters/dropbox-adapter.js';
export type { DropboxAdapterOptions } from './adapters/dropbox-adapter.js';
export {
  DROPBOX_ENDPOINTS,
  buildDropboxAuthUrl,
  exchangeDropboxAuthCode,
  createDropboxTokenProvider,
  revokeDropboxToken,
} from './oauth/dropbox.js';
export { OneDriveAdapter } from './adapters/onedrive-adapter.js';
export type { OneDriveAdapterOptions } from './adapters/onedrive-adapter.js';
export {
  ONEDRIVE_ENDPOINTS,
  ONEDRIVE_SCOPE,
  buildOneDriveAuthUrl,
  exchangeOneDriveAuthCode,
  createOneDriveTokenProvider,
} from './oauth/onedrive.js';
export {
  generateCodeVerifier,
  generateCodeChallenge,
  buildAuthUrl,
  exchangeAuthCode,
  refreshAccessToken,
  revokeToken,
  createCachedTokenProvider,
  GoogleOAuthError,
} from './oauth/google.js';
export type {
  BuildAuthUrlParams,
  ExchangeAuthCodeParams,
  TokenResponse,
  RefreshParams,
  RefreshResponse,
} from './oauth/google.js';
export { OAuthError } from './oauth/oauth-client.js';
export { generateState } from './oauth/pkce.js';
export type { OAuthEndpoints } from './oauth/oauth-client.js';
export { deleteCloudVault } from './delete-cloud-vault.js';
export type { DeleteCloudVaultResult } from './delete-cloud-vault.js';
export { checkCloudConflict } from './check-cloud-conflict.js';
export type { CloudConflictResult } from './check-cloud-conflict.js';
export {
  encryptSyncConfig,
  decryptSyncConfig,
  createAdapterFromConfig,
  createSyncEngineFromConfig,
  initSyncEngine,
  getAvailableProviders,
  deriveMEKFromAdapter,
  DEFAULT_SYNC_CONFIG,
} from './sync-config.js';
export type { SyncConfig, SyncProvider, AdapterOverrides } from './sync-config.js';
export { PREAMBLE_SIZE, encryptVaultBlob, decryptVaultBlob, readPreambleFromBlob, VaultBlobSchema } from './blob/vault-blob.js';
export type { VaultBlob } from './blob/vault-blob.js';
export { generateSyncSalt, deriveMEK, validateArgon2Params } from './blob/mek.js';
export { restoreFromCloud } from './restore.js';
export type { RestoreFromCloudResult, RestoreProgressEvent } from './restore.js';
export { SyncLifecycle } from './sync-lifecycle.js';
export type {
  PlatformStorage,
  SyncLifecycleCallbacks,
  SubscribableSyncStore,
} from './sync-lifecycle.js';
