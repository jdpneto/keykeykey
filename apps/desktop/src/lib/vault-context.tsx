import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
  useEffect,
  useMemo,
} from 'react';
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
import { toBase64, fromBase64, pMap } from '@keykeykey/core/utils';
import { createDesktopBiometricAdapter } from './desktop-biometric-adapter';
import type { SyncConfig, VaultMismatchInfo, RestoreProgressEvent } from '@keykeykey/core/sync';
import { SyncLifecycle } from '@keykeykey/core/sync';
import { createDesktopPlatformStorage, clearSyncConfigData } from './sync';
import {
  saveVaultHeader,
  loadVaultHeader,
  saveEncryptedItem,
  loadAllEncryptedItems,
  deleteEncryptedItem,
  setVaultSetupComplete,
  isVaultSetupComplete,
} from './tauri-storage';
import {
  savePinDataToKeyring,
  loadPinDataFromKeyring,
  deletePinDataFromKeyring,
  savePinAttemptsToKeyring,
  loadPinAttemptsFromKeyring,
  deletePinAttemptsFromKeyring,
  deleteBiometricDEKFromKeyring,
} from './keyring-storage';
import { invoke } from '@tauri-apps/api/core';
import { useAutoLockSetting } from './use-auto-lock-setting';

const KEY_QUICK_UNLOCK_PROMPT = 'keykeykey_quick_unlock_prompt';

type Store = ReturnType<typeof createVaultStore>;

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
  pinConfigured: boolean;
  unlockWithPin: (pin: string) => Promise<{ success: boolean; attemptsRemaining: number | null }>;
  enablePin: (pin: string) => Promise<void>;
  disablePin: () => Promise<void>;
  biometricAvailable: boolean;
  unlockWithBiometric: () => Promise<BiometricResult>;
  enableBiometric: () => Promise<void>;
  disableBiometric: () => Promise<void>;
  resetVault: () => Promise<void>;
  quickUnlockPromptShown: boolean;
  dismissQuickUnlockPrompt: () => Promise<void>;
  syncConfig: SyncConfig | null;
  getSyncStatus: () => { isSyncing: boolean };
  lastSynced: string | null;
  saveSyncConfig: (config: SyncConfig) => Promise<void>;
  validateMasterPassword: (password: string) => Promise<boolean>;
  triggerSync: () => Promise<{ lastSynced: string | null; error: string | null }>;
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
    onProgress?: (event: RestoreProgressEvent) => void,
  ) => Promise<{ success: boolean; error?: string; itemCount?: number }>;
  autoLockMinutes: number;
  setAutoLockMinutes: (minutes: number) => void;
};

const VaultContext = createContext<VaultContextType | null>(null);

export function VaultProvider({ children }: { children: React.ReactNode }) {
  const storeRef = useRef<Store>(createVaultStore());
  const [status, setStatus] = useState<'loading' | 'needs_setup' | 'locked' | 'unlocked'>(
    'loading',
  );
  const [items, setItems] = useState<VaultItem[]>([]);
  const [recoveryKey, setRecoveryKey] = useState<string | null>(null);
  const [pinConfigured, setPinConfigured] = useState(false);
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const biometricAdapterRef = useRef(createDesktopBiometricAdapter());
  // true means "already shown / dismissed" — prompt only shows when false
  const [quickUnlockPromptShown, setQuickUnlockPromptShown] = useState(true);
  const [syncConfig, setSyncConfig] = useState<SyncConfig | null>(null);
  const [lastSynced, setLastSyncedState] = useState<string | null>(() =>
    localStorage.getItem('keykeykey_lastSynced'),
  );
  const setLastSynced = useCallback((value: string | null) => {
    setLastSyncedState(value);
    if (value) {
      localStorage.setItem('keykeykey_lastSynced', value);
    } else {
      localStorage.removeItem('keykeykey_lastSynced');
    }
  }, []);
  const [vaultMismatchInfo, setVaultMismatchInfo] = useState<VaultMismatchInfo | null>(null);
  const lifecycleRef = useRef<SyncLifecycle | null>(null);
  const { autoLockMinutes, setAutoLockMinutes } = useAutoLockSetting();

  const syncableStore = useMemo(
    () => ({
      getState: () => storeRef.current.getState(),
      setState: (partial: Partial<{ items: import('@keykeykey/core').VaultItem[] }>) =>
        storeRef.current.setState(partial),
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
        storage: createDesktopPlatformStorage(),
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
    const pinDataRaw = await loadPinDataFromKeyring();
    setPinConfigured(pinDataRaw !== null);
    const available = await biometricAdapterRef.current.isAvailable();
    setBiometricAvailable(available);
    // TODO: Move to SQLite per spec — keyring is overkill for a non-secret flag.
    const promptFlag = await invoke<string | null>('load_from_keyring', {
      key: KEY_QUICK_UNLOCK_PROMPT,
    });
    // promptFlag === 'dismissed' means user already saw & dismissed the prompt
    setQuickUnlockPromptShown(promptFlag === 'dismissed');
  }, []);

  const setupVault = useCallback(async (masterPassword: string): Promise<string> => {
    const recovery = generateRecoveryKey();
    const { header } = await createVaultHeader(
      masterPassword,
      recovery.raw,
      ARGON2_PRESETS.desktop,
    );

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

  const unlockWithPin = useCallback(
    async (pin: string): Promise<{ success: boolean; attemptsRemaining: number | null }> => {
      const pinDataRaw = await loadPinDataFromKeyring();
      if (!pinDataRaw) return { success: false, attemptsRemaining: null };
      const { wrappedDEK, salt } = JSON.parse(pinDataRaw) as { wrappedDEK: string; salt: string };
      const pinData: PinData = { wrappedDEK: fromBase64(wrappedDEK), salt: fromBase64(salt) };
      const dek = await unwrapDekWithPin(pin, pinData);
      if (!dek) {
        let remaining = (await loadPinAttemptsFromKeyring()) ?? MAX_PIN_ATTEMPTS;
        remaining -= 1;
        if (remaining <= 0) {
          await deletePinDataFromKeyring();
          await deletePinAttemptsFromKeyring();
          setPinConfigured(false);
          return { success: false, attemptsRemaining: 0 };
        }
        await savePinAttemptsToKeyring(remaining);
        return { success: false, attemptsRemaining: remaining };
      }
      await savePinAttemptsToKeyring(MAX_PIN_ATTEMPTS);
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

  const enablePin = useCallback(async (pin: string) => {
    const dek = storeRef.current.getState().getDEK();
    const pinData = await setupPin(pin, dek);
    const serialized = JSON.stringify({
      wrappedDEK: toBase64(pinData.wrappedDEK),
      salt: toBase64(pinData.salt),
    });
    await savePinDataToKeyring(serialized);
    await savePinAttemptsToKeyring(MAX_PIN_ATTEMPTS);
    setPinConfigured(true);
  }, []);

  const disablePin = useCallback(async () => {
    await deletePinDataFromKeyring();
    await deletePinAttemptsFromKeyring();
    setPinConfigured(false);
  }, []);

  const unlockWithBiometric = useCallback(async (): Promise<BiometricResult> => {
    const result = await biometricAdapterRef.current.loadDEK();
    if (result.status === 'success') {
      const storedItems = await loadAllEncryptedItems();
      const encryptedArrays = storedItems.map((item) => fromBase64(item.encrypted_data));
      storeRef.current.getState().unlockWithDEK(result.dek, encryptedArrays);
      syncItems();
      setStatus('unlocked');
      await initSyncAfterUnlock();
    } else if (result.status === 'invalidated') {
      await biometricAdapterRef.current.clearDEK();
    }
    return result;
  }, [syncItems, initSyncAfterUnlock]);

  const enableBiometric = useCallback(async () => {
    const dek = storeRef.current.getState().getDEK();
    await biometricAdapterRef.current.saveDEK(dek);
  }, []);

  const disableBiometric = useCallback(async () => {
    await biometricAdapterRef.current.clearDEK();
    setBiometricAvailable(false);
  }, []);

  const dismissQuickUnlockPrompt = useCallback(async () => {
    // TODO: Move to SQLite per spec — keyring is overkill for a non-secret flag.
    await invoke('save_to_keyring', { key: KEY_QUICK_UNLOCK_PROMPT, value: 'dismissed' });
    setQuickUnlockPromptShown(true);
  }, []);

  const validateMasterPassword = useCallback(async (password: string): Promise<boolean> => {
    const lifecycle = lifecycleRef.current;
    if (lifecycle) return lifecycle.validateMasterPassword(password);
    // Fallback if lifecycle not created yet
    const header = storeRef.current.getState().header;
    if (!header) return false;
    try {
      const { unlockVault } = await import('@keykeykey/core');
      const dek = await unlockVault(header, password);
      dek.fill(0);
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
    const result = await lifecycle.triggerSync();
    if (result.lastSynced) setLastSynced(result.lastSynced);
    return result;
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
    async (
      config: SyncConfig,
      masterPassword: string,
      onProgress?: (event: RestoreProgressEvent) => void,
    ) => {
      const lifecycle = getOrCreateLifecycle();
      const result = await lifecycle.restoreFromCloud(config, masterPassword, onProgress);
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

  const resetVault = useCallback(async () => {
    // 0. Teardown sync lifecycle
    lifecycleRef.current?.teardown();
    lifecycleRef.current = null;
    setSyncConfig(null);
    await clearSyncConfigData();

    // 1. Core store reset (zeros DEK, clears items, nulls header)
    storeRef.current.getState().resetVault();

    // 2. Clear vault header from storage (contains wrapped DEKs, salts, KDF params)
    try {
      await saveVaultHeader('');
    } catch {
      /* ignore */
    }

    // 3. Clear all encrypted items from Tauri SQLite
    try {
      const storedItems = await loadAllEncryptedItems();
      await pMap(storedItems, (item) => deleteEncryptedItem(item.id));
    } catch {
      /* ignore — best-effort cleanup */
    }

    // 4. Mark vault setup incomplete
    try {
      await setVaultSetupComplete(false);
    } catch {
      /* ignore */
    }

    // 5. Clear PIN data from OS keyring
    try {
      await deletePinDataFromKeyring();
    } catch {
      /* ignore */
    }
    try {
      await deletePinAttemptsFromKeyring();
    } catch {
      /* ignore */
    }

    // 6. Clear biometric DEK from OS keyring
    try {
      await deleteBiometricDEKFromKeyring();
    } catch {
      /* ignore */
    }

    // 7. Update local state
    setStatus('needs_setup');
    setItems([]);
    setPinConfigured(false);
    // Note: biometricAvailable reflects hardware capability, not vault state.
    // It will be re-evaluated during the next initialize() call after setup.
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
      const addedItems = ids
        .map((id) => state.items.find((i: VaultItem) => i.id === id))
        .filter((item): item is VaultItem => item !== undefined);
      await pMap(addedItems, async (added) => {
        const encrypted = state.encryptItem(added);
        await saveEncryptedItem(
          added.id,
          added.type,
          toBase64(encrypted),
          added.createdAt,
          added.updatedAt,
        );
      });
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

  const search = useCallback((query: string): VaultItem[] => {
    return storeRef.current.getState().search(query);
  }, []);

  // Auto-lock after inactivity. Resets on user interaction (mousedown, keydown, touchstart, scroll).
  useEffect(() => {
    if (status !== 'unlocked' || autoLockMinutes === 0) return;

    const ms = autoLockMinutes * 60 * 1000;
    let timer = setTimeout(lock, ms);

    // Throttled reset — at most once per second
    let lastReset = 0;
    const reset = () => {
      const now = Date.now();
      if (now - lastReset < 1000) return;
      lastReset = now;
      clearTimeout(timer);
      timer = setTimeout(lock, ms);
    };

    const events = ['mousedown', 'keydown', 'touchstart', 'scroll'] as const;
    events.forEach((e) => document.addEventListener(e, reset, { passive: true }));

    return () => {
      clearTimeout(timer);
      events.forEach((e) => document.removeEventListener(e, reset));
    };
  }, [status, autoLockMinutes, lock]);

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
        resetVault,
        pinConfigured,
        unlockWithPin,
        enablePin,
        disablePin,
        biometricAvailable,
        unlockWithBiometric,
        enableBiometric,
        disableBiometric,
        quickUnlockPromptShown,
        dismissQuickUnlockPrompt,
        syncConfig,
        getSyncStatus,
        lastSynced,
        validateMasterPassword,
        saveSyncConfig: saveSyncConfigAction,
        triggerSync,
        vaultMismatchInfo,
        clearVaultMismatch,
        replaceRemoteVault,
        mergeRemoteVault,
        replaceLocalVault,
        restoreFromCloud: restoreFromCloudAction,
        autoLockMinutes,
        setAutoLockMinutes,
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
