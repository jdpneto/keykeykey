/**
 * Shared storage abstraction for cross-process vault access.
 *
 * Phase 1 (current): Re-exports from storage.ts (app-private storage)
 * Phase 2 (iOS App Group): Replace with shared container implementations:
 *   - Vault header → shared Keychain access group
 *   - Encrypted items → App Group shared SQLite with WAL mode
 *   - Biometric DEK → shared Keychain with biometric access control
 *   - PIN data → App Group shared UserDefaults
 */
export {
  saveVaultHeader,
  loadVaultHeader,
  deleteVaultHeader,
  saveBiometricDEK,
  loadBiometricDEK,
  deleteBiometricDEK,
  savePinData,
  loadPinData,
  deletePinData,
  savePinAttempts,
  loadPinAttempts,
  deletePinAttempts,
  getDB,
  saveEncryptedItem,
  loadAllEncryptedItems,
  deleteEncryptedItem,
  deleteAllEncryptedItems,
} from './storage';
