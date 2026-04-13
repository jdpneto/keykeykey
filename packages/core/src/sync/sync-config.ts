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
