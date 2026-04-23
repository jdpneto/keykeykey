/**
 * Shared storage abstraction for cross-process vault access.
 *
 * Storage is shared between the main app and iOS credential provider extension:
 *   - Vault header → shared Keychain access group (via keychainAccessGroup option)
 *   - Encrypted items → App Group shared SQLite with WAL mode (via AppGroupPath module)
 *   - Biometric DEK → shared Keychain with biometric access control
 *   - PIN data → shared Keychain access group
 *
 * On Android, all storage remains app-private since the AutofillService
 * runs in the same app process.
 */
export {
  saveVaultHeader,
  loadVaultHeader,
  deleteVaultHeader,
  saveBiometricDEK,
  loadBiometricDEK,
  deleteBiometricDEK,
  setBiometricEnabledFlag,
  isBiometricEnabled,
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
