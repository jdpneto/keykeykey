/**
 * Sync adapter interface and implementations for BYOC (Bring Your Own Cloud) sync.
 *
 * @module sync
 */

export type { ISyncAdapter, SyncManifest, SyncItemMeta, TombstoneEntry } from './core/types.js';

export { MemoryAdapter } from './memory-adapter.js';
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
export { WebDavAdapter } from './webdav-adapter.js';
export type { WebDavAdapterOptions } from './webdav-adapter.js';
export { GoogleDriveAdapter } from './google-drive-adapter.js';
export type { GoogleDriveAdapterOptions } from './google-drive-adapter.js';
export { DropboxAdapter } from './dropbox-adapter.js';
export type { DropboxAdapterOptions } from './dropbox-adapter.js';
export {
  DROPBOX_ENDPOINTS,
  buildDropboxAuthUrl,
  exchangeDropboxAuthCode,
  createDropboxTokenProvider,
  revokeDropboxToken,
} from './dropbox-oauth.js';
export { OneDriveAdapter } from './onedrive-adapter.js';
export type { OneDriveAdapterOptions } from './onedrive-adapter.js';
export {
  ONEDRIVE_ENDPOINTS,
  ONEDRIVE_SCOPE,
  buildOneDriveAuthUrl,
  exchangeOneDriveAuthCode,
  createOneDriveTokenProvider,
} from './onedrive-oauth.js';
export {
  generateCodeVerifier,
  generateCodeChallenge,
  buildAuthUrl,
  exchangeAuthCode,
  refreshAccessToken,
  revokeToken,
  createCachedTokenProvider,
  GoogleOAuthError,
} from './google-oauth.js';
export type {
  BuildAuthUrlParams,
  ExchangeAuthCodeParams,
  TokenResponse,
  RefreshParams,
  RefreshResponse,
} from './google-oauth.js';
export { OAuthError, generateState } from './oauth.js';
export type { OAuthEndpoints } from './oauth.js';
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
export {
  PREAMBLE_SIZE,
  generateSyncSalt,
  deriveMEK,
  validateArgon2Params,
  encryptVaultBlob,
  decryptVaultBlob,
  readPreambleFromBlob,
  VaultBlobSchema,
} from './vault-blob.js';
export type { VaultBlob } from './vault-blob.js';
export { restoreFromCloud } from './restore.js';
export type { RestoreFromCloudResult, RestoreProgressEvent } from './restore.js';
export { SyncLifecycle } from './sync-lifecycle.js';
export type {
  PlatformStorage,
  SyncLifecycleCallbacks,
  SubscribableSyncStore,
} from './sync-lifecycle.js';
