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
export type { SyncResult, SyncableStore, SyncEngineOptions } from './sync-engine.js';
export { connectSyncEngine } from './connect.js';
export { WebDavAdapter } from './webdav-adapter.js';
export type { WebDavConfig } from './webdav-adapter.js';
export { GoogleDriveAdapter } from './google-drive-adapter.js';
export type { GoogleDriveConfig } from './google-drive-adapter.js';
export { ICloudAdapter } from './icloud-adapter.js';
export type { ICloudConfig, ICloudFs } from './icloud-adapter.js';
