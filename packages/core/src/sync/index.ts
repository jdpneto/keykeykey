/**
 * Sync adapter interface and implementations for BYOC (Bring Your Own Cloud) sync.
 *
 * @module sync
 */

export { mergeManifests } from './types.js';
export type { ISyncAdapter, SyncManifest, SyncItemMeta, TombstoneEntry } from './types.js';

export { MemoryAdapter } from './memory-adapter.js';
