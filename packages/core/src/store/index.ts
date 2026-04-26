/**
 * Vault state management using Zustand (vanilla).
 *
 * @module store
 */

export { createVaultStore } from './vault-store.js';
export type {
  VaultState,
  VaultActions,
  VaultStore,
  VaultStatus,
  SearchOptions,
  VaultItemType,
} from './vault-store.js';
export { rebuildAfterRestore } from './password-history.js';
export type { PasswordHistoryEntry, RebuildResult } from './password-history.js';
