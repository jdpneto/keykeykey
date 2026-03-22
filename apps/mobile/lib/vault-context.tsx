import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
  useEffect,
  useMemo,
} from 'react';
import { AppState, type AppStateStatus, Platform, NativeModules } from 'react-native';
import {
  createVaultStore,
  createVaultHeader,
  serializeVaultHeader,
  deserializeVaultHeader,
  generateRecoveryKey,
  ARGON2_PRESETS,
  type VaultItem,
} from '@keykeykey/core';
import { setupPin, unwrapDekWithPin, MAX_PIN_ATTEMPTS } from '@keykeykey/core/pin';
import type { PinData } from '@keykeykey/core/pin';
import type { BiometricResult } from '@keykeykey/core/biometric';
import { toBase64, fromBase64 } from '@keykeykey/core/utils';
import {
  saveVaultHeader,
  loadVaultHeader,
  saveEncryptedItem,
  loadAllEncryptedItems,
  deleteEncryptedItem,
  deleteAllEncryptedItems,
  deleteVaultHeader,
  deleteBiometricDEK,
  setVaultSetupComplete,
  isVaultSetupComplete,
  savePinData as savePinDataStorage,
  loadPinData as loadPinDataStorage,
  deletePinData,
  savePinAttempts,
  loadPinAttempts,
  deletePinAttempts,
  setQuickUnlockPromptShown,
  isQuickUnlockPromptShown,
} from './storage';
import { createMobileBiometricAdapter } from './biometric-adapter';
import type { SyncConfig, SyncableStore, VaultMismatchInfo } from '@keykeykey/core/sync';
import { SyncLifecycle } from '@keykeykey/core/sync';
import { createMobilePlatformStorage, clearSyncConfigData } from './sync';

type Store = ReturnType<typeof createVaultStore>;

/** Auto-lock after 5 minutes of app being in background */
const AUTO_LOCK_TIMEOUT_MS = 5 * 60 * 1000;

type VaultContextType = {
  status: 'loading' | 'needs_setup' | 'locked' | 'unlocked';
  items: VaultItem[];
  recoveryKey: string | null;
  setupVault: (masterPassword: string) => Promise<string>;
  unlock: (masterPassword: string) => Promise<void>;
  lock: () => void;
  addItem: (item: Omit<VaultItem, 'id' | 'createdAt' | 'updatedAt'>) => Promise<string>;
  addItems: (items: Omit<VaultItem, 'id' | 'createdAt' | 'updatedAt'>[]) => Promise<string[]>;
  updateItem: (
    id: string,
    updates: Partial<Omit<VaultItem, 'id' | 'type' | 'createdAt'>>,
  ) => Promise<void>;
  removeItem: (id: string) => Promise<void>;
  search: (query: string) => VaultItem[];
  initialize: () => Promise<void>;
  biometricAvailable: boolean;
  pinConfigured: boolean;
  quickUnlockPromptShown: boolean;
  unlockWithBiometric: () => Promise<BiometricResult>;
  unlockWithPin: (pin: string) => Promise<{ success: boolean; attemptsRemaining: number | null }>;
  enableBiometric: () => Promise<void>;
  disableBiometric: () => Promise<void>;
  enablePin: (pin: string) => Promise<void>;
  disablePin: () => Promise<void>;
  dismissQuickUnlockPrompt: () => Promise<void>;
  resetVault: () => Promise<void>;
  syncConfig: SyncConfig | null;
  getSyncStatus: () => { isSyncing: boolean };
  saveSyncConfig: (config: SyncConfig) => Promise<void>;
  triggerSync: () => Promise<{ lastSynced: string | null; error: string | null }>;
  validateMasterPassword: (password: string) => Promise<boolean>;
  vaultMismatchInfo: VaultMismatchInfo | null;
  clearVaultMismatch: () => Promise<void>;
  replaceRemoteVault: () => Promise<{ success: boolean; error?: string }>;
  mergeRemoteVault: () => Promise<{
    success: boolean;
    error?: string;
    added?: number;
    updated?: number;
  }>;
  replaceLocalVault: () => Promise<{ success: boolean; error?: string }>;
  restoreFromCloud: (
    syncConfig: SyncConfig,
    masterPassword: string,
  ) => Promise<{ success: boolean; error?: string; itemCount?: number }>;
};

const VaultContext = createContext<VaultContextType | null>(null);

export function VaultProvider({ children }: { children: React.ReactNode }) {
  const storeRef = useRef<Store>(createVaultStore());
  const [status, setStatus] = useState<'loading' | 'needs_setup' | 'locked' | 'unlocked'>(
    'loading',
  );
  const [items, setItems] = useState<VaultItem[]>([]);
  const [recoveryKey, setRecoveryKey] = useState<string | null>(null);
  const biometricAdapter = useRef(createMobileBiometricAdapter());
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [pinConfigured, setPinConfigured] = useState(false);
  const [quickUnlockPromptShown, setQuickUnlockPromptShownState] = useState(true);
  const [syncConfig, setSyncConfig] = useState<SyncConfig | null>(null);
  const [vaultMismatchInfo, setVaultMismatchInfo] = useState<VaultMismatchInfo | null>(null);
  const lifecycleRef = useRef<SyncLifecycle | null>(null);

  const syncableStore = useMemo(
    () => ({
      getState: () => storeRef.current.getState(),
      setState: (partial: Partial<{ items: VaultItem[] }>) => storeRef.current.setState(partial),
      getVaultId: () => storeRef.current.getState().header?.vaultId ?? '',
      subscribe: (
        listener: (
          state: { status: string; items: unknown[] },
          prevState: { status: string; items: unknown[] },
        ) => void,
      ) => storeRef.current.subscribe(listener),
    }),
    [],
  );

  const syncItems = useCallback(() => {
    const state = storeRef.current.getState();
    setItems([...state.items]);
  }, []);

  // Subscribe to Zustand store changes so pulled items from sync engine update the UI
  useEffect(() => {
    if (typeof storeRef.current.subscribe !== 'function') return;
    const unsub = storeRef.current.subscribe(
      (
        state: { items: unknown[]; status: string },
        prevState: { items: unknown[]; status: string },
      ) => {
        if (state.items !== prevState.items && state.status === 'unlocked') {
          setItems([...(state.items as VaultItem[])]);
        }
      },
    );
    return unsub;
  }, []);

  const getOrCreateLifecycle = useCallback(() => {
    if (!lifecycleRef.current) {
      lifecycleRef.current = new SyncLifecycle({
        store: syncableStore,
        storage: createMobilePlatformStorage(),
        platformCallbacks: {},
        callbacks: {
          onConfigChanged: (config: SyncConfig) => setSyncConfig(config),
          onMismatch: (info: VaultMismatchInfo) => setVaultMismatchInfo(info),
          onMismatchCleared: () => setVaultMismatchInfo(null),
          onItemsChanged: () => syncItems(),
        },
        getHeader: () => storeRef.current.getState().header ?? null,
      });
    }
    return lifecycleRef.current;
  }, [syncableStore, syncItems]);

  const getSyncStatus = useCallback(
    () => lifecycleRef.current?.getStatus() ?? { isSyncing: false },
    [],
  );

  const initialize = useCallback(async () => {
    const setupComplete = await isVaultSetupComplete();
    if (!setupComplete) {
      setStatus('needs_setup');
      return;
    }
    const headerB64 = await loadVaultHeader();
    if (!headerB64) {
      setStatus('needs_setup');
      return;
    }
    const headerBytes = fromBase64(headerB64);
    const header = deserializeVaultHeader(headerBytes);

    // Migrate v1 headers to v2 (assigns stable vaultId)
    if (header.version === 1) {
      header.version = 2;
      const v2Bytes = serializeVaultHeader(header);
      await saveVaultHeader(toBase64(v2Bytes));
    }

    storeRef.current.getState().loadHeader(header);
    setStatus('locked');
    const bioAvail = await biometricAdapter.current.isAvailable();
    setBiometricAvailable(bioAvail);
    const pinDataRaw = await loadPinDataStorage();
    setPinConfigured(pinDataRaw !== null);
    const promptShown = await isQuickUnlockPromptShown();
    setQuickUnlockPromptShownState(promptShown);
  }, []);

  const setupVault = useCallback(async (masterPassword: string): Promise<string> => {
    const recovery = generateRecoveryKey();
    const { header } = await createVaultHeader(masterPassword, recovery.raw, ARGON2_PRESETS.mobile);

    const serialized = serializeVaultHeader(header);
    await saveVaultHeader(toBase64(serialized));
    await setVaultSetupComplete(true);

    const store = createVaultStore();
    store.getState().loadHeader(header);
    await store.getState().unlock(masterPassword, []);
    storeRef.current = store;

    setRecoveryKey(recovery.formatted);
    setItems([]);
    setStatus('unlocked');
    return recovery.formatted;
  }, []);

  const lock = useCallback(() => {
    lifecycleRef.current?.teardown();
    lifecycleRef.current = null;
    setSyncConfig(null);
    storeRef.current.getState().lock();
    setItems([]);
    setStatus('locked');
    // Clear the native autofill DEK cache on Android
    if (Platform.OS === 'android') {
      try {
        NativeModules.AutofillSaveData?.clearDEKCache();
      } catch {
        // Module not available in tests
      }
    }
  }, []);

  const initSyncAfterUnlock = useCallback(async () => {
    const lifecycle = getOrCreateLifecycle();
    try {
      await lifecycle.initAfterUnlock();
    } catch (err) {
      console.warn('Sync initialization failed:', err instanceof Error ? err.message : err);
    }
  }, [getOrCreateLifecycle]);

  const unlock = useCallback(
    async (masterPassword: string) => {
      const storedItems = await loadAllEncryptedItems();
      const encryptedArrays = storedItems.map((item) => fromBase64(item.encrypted_data));
      await storeRef.current.getState().unlock(masterPassword, encryptedArrays);
      syncItems();
      setStatus('unlocked');
      await initSyncAfterUnlock();
    },
    [syncItems, initSyncAfterUnlock],
  );

  const unlockWithBiometric = useCallback(async (): Promise<BiometricResult> => {
    const result = await biometricAdapter.current.loadDEK();
    if (result.status === 'invalidated') {
      await biometricAdapter.current.clearDEK();
      return result;
    }
    if (result.status !== 'success') return result;
    const storedItems = await loadAllEncryptedItems();
    const encryptedArrays = storedItems.map((item) => fromBase64(item.encrypted_data));
    storeRef.current.getState().unlockWithDEK(result.dek, encryptedArrays);
    syncItems();
    setStatus('unlocked');
    await initSyncAfterUnlock();
    return result;
  }, [syncItems, initSyncAfterUnlock]);

  const unlockWithPin = useCallback(
    async (pin: string): Promise<{ success: boolean; attemptsRemaining: number | null }> => {
      const pinDataRaw = await loadPinDataStorage();
      if (!pinDataRaw) return { success: false, attemptsRemaining: null };
      const { wrappedDEK, salt } = JSON.parse(pinDataRaw) as { wrappedDEK: string; salt: string };
      const pinData: PinData = { wrappedDEK: fromBase64(wrappedDEK), salt: fromBase64(salt) };
      const dek = await unwrapDekWithPin(pin, pinData);
      if (!dek) {
        let remaining = (await loadPinAttempts()) ?? MAX_PIN_ATTEMPTS;
        remaining -= 1;
        if (remaining <= 0) {
          await deletePinData();
          await deletePinAttempts();
          setPinConfigured(false);
          return { success: false, attemptsRemaining: 0 };
        }
        await savePinAttempts(remaining);
        return { success: false, attemptsRemaining: remaining };
      }
      await savePinAttempts(MAX_PIN_ATTEMPTS);
      const storedItems = await loadAllEncryptedItems();
      const encryptedArrays = storedItems.map((item) => fromBase64(item.encrypted_data));
      storeRef.current.getState().unlockWithDEK(dek, encryptedArrays);
      syncItems();
      setStatus('unlocked');
      await initSyncAfterUnlock();
      return { success: true, attemptsRemaining: MAX_PIN_ATTEMPTS };
    },
    [syncItems, initSyncAfterUnlock],
  );

  const enableBiometric = useCallback(async () => {
    const dek = storeRef.current.getState().getDEK();
    await biometricAdapter.current.saveDEK(dek);
    setBiometricAvailable(true);
  }, []);

  const disableBiometric = useCallback(async () => {
    await biometricAdapter.current.clearDEK();
    setBiometricAvailable(false);
  }, []);

  const enablePin = useCallback(async (pin: string) => {
    const dek = storeRef.current.getState().getDEK();
    const pinData = await setupPin(pin, dek);
    const serialized = JSON.stringify({
      wrappedDEK: toBase64(pinData.wrappedDEK),
      salt: toBase64(pinData.salt),
    });
    await savePinDataStorage(serialized);
    await savePinAttempts(MAX_PIN_ATTEMPTS);
    setPinConfigured(true);
  }, []);

  const disablePin = useCallback(async () => {
    await deletePinData();
    await deletePinAttempts();
    setPinConfigured(false);
  }, []);

  const dismissQuickUnlockPrompt = useCallback(async () => {
    await setQuickUnlockPromptShown(true);
    setQuickUnlockPromptShownState(true);
  }, []);

  const resetVault = useCallback(async () => {
    // Teardown sync lifecycle
    lifecycleRef.current?.teardown();
    lifecycleRef.current = null;
    setSyncConfig(null);
    await clearSyncConfigData();

    storeRef.current.getState().resetVault();
    try {
      await deleteVaultHeader();
    } catch {
      /* ignore */
    }
    try {
      await deleteAllEncryptedItems();
    } catch {
      /* ignore */
    }
    try {
      await setVaultSetupComplete(false);
    } catch {
      /* ignore */
    }
    try {
      await deleteBiometricDEK();
    } catch {
      /* ignore */
    }
    try {
      await deletePinData();
    } catch {
      /* ignore */
    }
    try {
      await deletePinAttempts();
    } catch {
      /* ignore */
    }
    setStatus('needs_setup');
    setItems([]);
    setPinConfigured(false);
  }, []);

  const addItem = useCallback(
    async (item: Omit<VaultItem, 'id' | 'createdAt' | 'updatedAt'>): Promise<string> => {
      const id = storeRef.current.getState().addItem(item);
      const state = storeRef.current.getState();
      const added = state.items.find((i: VaultItem) => i.id === id);
      if (added) {
        const encrypted = state.encryptItem(added);
        await saveEncryptedItem(
          id,
          added.type,
          toBase64(encrypted),
          added.createdAt,
          added.updatedAt,
        );
      }
      syncItems();
      return id;
    },
    [syncItems],
  );

  const addItems = useCallback(
    async (itemsData: Omit<VaultItem, 'id' | 'createdAt' | 'updatedAt'>[]): Promise<string[]> => {
      const ids = storeRef.current.getState().addItems(itemsData);
      const state = storeRef.current.getState();
      for (const id of ids) {
        const added = state.items.find((i: VaultItem) => i.id === id);
        if (added) {
          const encrypted = state.encryptItem(added);
          await saveEncryptedItem(
            id,
            added.type,
            toBase64(encrypted),
            added.createdAt,
            added.updatedAt,
          );
        }
      }
      syncItems();
      return ids;
    },
    [syncItems],
  );

  const updateItem = useCallback(
    async (id: string, updates: Partial<Omit<VaultItem, 'id' | 'type' | 'createdAt'>>) => {
      storeRef.current.getState().updateItem(id, updates);
      const state = storeRef.current.getState();
      const updated = state.items.find((i: VaultItem) => i.id === id);
      if (updated) {
        const encrypted = state.encryptItem(updated);
        await saveEncryptedItem(
          id,
          updated.type,
          toBase64(encrypted),
          updated.createdAt,
          updated.updatedAt,
        );
      }
      syncItems();
    },
    [syncItems],
  );

  const removeItem = useCallback(
    async (id: string) => {
      storeRef.current.getState().deleteItem(id);
      await deleteEncryptedItem(id);
      lifecycleRef.current?.recordTombstone(id);
      syncItems();
    },
    [syncItems],
  );

  const validateMasterPassword = useCallback(async (password: string): Promise<boolean> => {
    const lifecycle = lifecycleRef.current;
    if (lifecycle) return lifecycle.validateMasterPassword(password);
    // Fallback if lifecycle not created yet
    const header = storeRef.current.getState().header;
    if (!header) return false;
    try {
      const { unlockVault } = await import('@keykeykey/core');
      await unlockVault(header, password);
      return true;
    } catch {
      return false;
    }
  }, []);

  const saveSyncConfigAction = useCallback(
    async (config: SyncConfig) => {
      const lifecycle = getOrCreateLifecycle();
      await lifecycle.saveConfig(config);
    },
    [getOrCreateLifecycle],
  );

  const triggerSync = useCallback(async () => {
    const lifecycle = lifecycleRef.current;
    if (!lifecycle) return { lastSynced: null, error: 'No sync engine' };
    return lifecycle.triggerSync();
  }, []);

  const clearVaultMismatch = useCallback(async () => {
    const lifecycle = lifecycleRef.current;
    if (lifecycle) {
      await lifecycle.clearMismatch();
    }
  }, []);

  const replaceRemoteVault = useCallback(async (): Promise<{
    success: boolean;
    error?: string;
  }> => {
    const lifecycle = lifecycleRef.current;
    if (!lifecycle) return { success: false, error: 'No sync lifecycle' };
    return lifecycle.replaceRemote();
  }, []);

  const mergeRemoteVault = useCallback(async (): Promise<{
    success: boolean;
    error?: string;
    added?: number;
    updated?: number;
  }> => {
    const lifecycle = lifecycleRef.current;
    if (!lifecycle) return { success: false, error: 'No sync lifecycle' };
    return lifecycle.mergeVaults();
  }, []);

  const replaceLocalVault = useCallback(async (): Promise<{
    success: boolean;
    error?: string;
  }> => {
    const lifecycle = lifecycleRef.current;
    if (!lifecycle) return { success: false, error: 'No sync lifecycle' };
    const config = lifecycle.config;
    if (!config || !config.masterPassword)
      return { success: false, error: 'No master password in sync config' };

    const result = await lifecycle.replaceLocal();
    if (result.success) {
      // Re-create and unlock the vault store with the restored data
      // (same pattern as restoreFromCloudAction)
      const headerB64 = await loadVaultHeader();
      if (headerB64) {
        const headerBytes = fromBase64(headerB64);
        const header = deserializeVaultHeader(headerBytes);
        const store = createVaultStore();
        store.getState().loadHeader(header);
        const storedItems = await loadAllEncryptedItems();
        const encryptedArrays = storedItems.map((item) => fromBase64(item.encrypted_data));
        await store.getState().unlock(config.masterPassword, encryptedArrays);
        storeRef.current = store;

        // Recreate lifecycle since store ref changed
        lifecycleRef.current = null;
        const newLifecycle = getOrCreateLifecycle();
        await newLifecycle.initAfterUnlock();

        setItems([...store.getState().items]);
      }
    }
    return result;
  }, [getOrCreateLifecycle]);

  const restoreFromCloudAction = useCallback(
    async (config: SyncConfig, masterPassword: string) => {
      const lifecycle = getOrCreateLifecycle();
      const result = await lifecycle.restoreFromCloud(config, masterPassword);
      if (result.success) {
        // Re-create and unlock the vault store with the restored header/items
        // The lifecycle has persisted everything to platform storage,
        // so we re-initialize, then unlock to load into memory
        const headerB64 = await loadVaultHeader();
        if (headerB64) {
          const headerBytes = fromBase64(headerB64);
          const header = deserializeVaultHeader(headerBytes);
          const store = createVaultStore();
          store.getState().loadHeader(header);
          const storedItems = await loadAllEncryptedItems();
          const encryptedArrays = storedItems.map((item) => fromBase64(item.encrypted_data));
          await store.getState().unlock(masterPassword, encryptedArrays);
          storeRef.current = store;

          // Need to recreate lifecycle since store ref changed
          lifecycleRef.current = null;
          const newLifecycle = getOrCreateLifecycle();
          await newLifecycle.initAfterUnlock();

          setItems([...store.getState().items]);
          setStatus('unlocked');
        }
      }
      return result;
    },
    [getOrCreateLifecycle],
  );

  const search = useCallback((query: string): VaultItem[] => {
    return storeRef.current.getState().search(query);
  }, []);

  // Auto-lock when app is backgrounded for too long
  const backgroundedAt = useRef<number | null>(null);
  useEffect(() => {
    const handleAppState = (nextState: AppStateStatus) => {
      if (nextState === 'background' || nextState === 'inactive') {
        backgroundedAt.current = Date.now();
      } else if (nextState === 'active' && backgroundedAt.current !== null) {
        const elapsed = Date.now() - backgroundedAt.current;
        backgroundedAt.current = null;
        if (elapsed >= AUTO_LOCK_TIMEOUT_MS && status === 'unlocked') {
          lock();
        }
      }
    };
    const subscription = AppState.addEventListener('change', handleAppState);
    return () => subscription.remove();
  }, [status, lock]);

  return (
    <VaultContext.Provider
      value={{
        status,
        items,
        recoveryKey,
        setupVault,
        unlock,
        lock,
        addItem,
        addItems,
        updateItem,
        removeItem,
        search,
        initialize,
        biometricAvailable,
        pinConfigured,
        quickUnlockPromptShown,
        unlockWithBiometric,
        unlockWithPin,
        enableBiometric,
        disableBiometric,
        enablePin,
        disablePin,
        dismissQuickUnlockPrompt,
        resetVault,
        syncConfig,
        getSyncStatus,
        saveSyncConfig: saveSyncConfigAction,
        triggerSync,
        validateMasterPassword,
        vaultMismatchInfo,
        clearVaultMismatch,
        replaceRemoteVault,
        mergeRemoteVault,
        replaceLocalVault,
        restoreFromCloud: restoreFromCloudAction,
      }}
    >
      {children}
    </VaultContext.Provider>
  );
}

export function useVault(): VaultContextType {
  const ctx = useContext(VaultContext);
  if (!ctx) throw new Error('useVault must be used within VaultProvider');
  return ctx;
}
