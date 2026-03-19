/**
 * Sync adapter interface and implementations for BYOC (Bring Your Own Cloud) sync.
 *
 * @module sync
 */

export { mergeManifests } from './types.js';
export type { ISyncAdapter, SyncManifest, SyncItemMeta, TombstoneEntry } from './types.js';

export { MemoryAdapter } from './memory-adapter.js';
export { garbageCollectTombstones } from './tombstone.js';
export { SyncAuthError, SyncAdapterUnsupportedError } from './errors.js';
export { mergeManifestsV2 } from './merge.js';
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
export { ICloudAdapter } from './icloud-adapter.js';
export type { ICloudConfig, ICloudFs } from './icloud-adapter.js';
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
  DEFAULT_SYNC_CONFIG,
} from './sync-config.js';
export type { SyncConfig, SyncProvider, AdapterPlatformCallbacks } from './sync-config.js';
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
