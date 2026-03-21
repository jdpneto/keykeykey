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
  unlockVault,
  ARGON2_PRESETS,
  type VaultItem,
} from '@keykeykey/core';
import { setupPin, unwrapDekWithPin, MAX_PIN_ATTEMPTS } from '@keykeykey/core/pin';
import type { PinData } from '@keykeykey/core/pin';
import type { BiometricResult } from '@keykeykey/core/biometric';
import { toBase64, fromBase64 } from '@keykeykey/core/utils';
import { createDesktopBiometricAdapter } from './desktop-biometric-adapter';
import type { SyncConfig, SyncableStore } from '@keykeykey/core/sync';
import type { SyncEngine, VaultMismatchInfo } from '@keykeykey/core/sync';
import {
  deriveMEK,
  generateSyncSalt,
  createAdapterFromConfig,
  deriveMEKFromAdapter,
  restoreFromCloud as restoreFromCloudCore,
  deleteCloudVault,
  mergeItemSets,
} from '@keykeykey/core/sync';
import {
  loadSyncConfig as loadSyncConfigFromFile,
  saveSyncConfig as saveSyncConfigToFile,
  clearSyncConfigData,
  createSyncEngineFromConfig,
  initSyncEngine,
  connectSyncEngine,
  setSyncUrlPrefix,
} from './sync';
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

const KEY_QUICK_UNLOCK_PROMPT = 'keykeykey_quick_unlock_prompt';

type Store = ReturnType<typeof createVaultStore>;

/** Auto-lock after 5 minutes of window being continuously hidden */
const AUTO_LOCK_TIMEOUT_MS = 5 * 60 * 1000;

type VaultContextType = {
  status: 'loading' | 'needs_setup' | 'locked' | 'unlocked';
  items: VaultItem[];
  recoveryKey: string | null;
  setupVault: (masterPassword: string) => Promise<string>;
  unlock: (masterPassword: string) => Promise<void>;
  lock: () => void;
  addItem: (item: Omit<VaultItem, 'id' | 'createdAt' | 'updatedAt'>) => Promise<string>;
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
  const [pinConfigured, setPinConfigured] = useState(false);
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const biometricAdapterRef = useRef(createDesktopBiometricAdapter());
  // true means "already shown / dismissed" — prompt only shows when false
  const [quickUnlockPromptShown, setQuickUnlockPromptShown] = useState(true);
  const [syncConfig, setSyncConfig] = useState<SyncConfig | null>(null);
  const [vaultMismatchInfo, setVaultMismatchInfo] = useState<VaultMismatchInfo | null>(null);
  const syncEngineRef = useRef<SyncEngine | null>(null);
  const syncDisconnectRef = useRef<(() => void) | null>(null);

  const getSyncStatus = useCallback(
    () => ({ isSyncing: syncEngineRef.current?.isSyncing() ?? false }),
    [],
  );

  const syncableStore: SyncableStore = useMemo(
    () => ({
      getState: () => storeRef.current.getState(),
      setState: (partial) => storeRef.current.setState(partial),
      getVaultId: () => storeRef.current.getState().header?.vaultId ?? '',
    }),
    [],
  );

  const syncItems = useCallback(() => {
    const state = storeRef.current.getState();
    setItems([...state.items]);
  }, []);

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
    syncDisconnectRef.current?.();
    syncDisconnectRef.current = null;
    syncEngineRef.current = null;
    setSyncConfig(null);
    storeRef.current.getState().lock();
    setItems([]);
    setStatus('locked');
  }, []);

  const handleVaultMismatch = useCallback((info: VaultMismatchInfo) => {
    syncDisconnectRef.current?.();
    syncDisconnectRef.current = null;
    syncEngineRef.current = null;
    setVaultMismatchInfo(info);
  }, []);

  const clearVaultMismatch = useCallback(async () => {
    setVaultMismatchInfo(null);
    // Disconnect sync to ensure clean state
    const dek = storeRef.current.getState().getDEK();
    await saveSyncConfigToFile({ provider: 'none' }, dek);
    setSyncConfig({ provider: 'none' });
    syncDisconnectRef.current?.();
    syncDisconnectRef.current = null;
    syncEngineRef.current = null;
    await setSyncUrlPrefix(null);
  }, []);

  const replaceRemoteVault = useCallback(async (): Promise<{
    success: boolean;
    error?: string;
  }> => {
    try {
      const config = syncConfig;
      if (!config || config.provider === 'none')
        return { success: false, error: 'No sync configured' };
      if (!config.masterPassword)
        return { success: false, error: 'Master password not stored in sync config' };

      // Set URL prefix for the proxy
      const urlPrefix = config.provider === 'webdav' && config.webdav ? config.webdav.url : null;
      await setSyncUrlPrefix(urlPrefix);

      // Create adapter to clear remote
      const adapter = createAdapterFromConfig(config, {});
      if (!adapter) return { success: false, error: 'Could not create adapter' };

      // Derive MEK on demand
      const header = storeRef.current.getState().header!;
      const vaultHeaderBytes = serializeVaultHeader(header);
      const syncSalt = generateSyncSalt();
      const mek = await deriveMEK(config.masterPassword, syncSalt, header.argon2Params);

      await deleteCloudVault(adapter, mek, syncSalt, vaultHeaderBytes, header.argon2Params);

      // Teardown old engine
      syncDisconnectRef.current?.();
      syncDisconnectRef.current = null;
      syncEngineRef.current = null;

      // Clear mismatch state
      setVaultMismatchInfo(null);

      // Re-create engine with fresh MEK
      const engine = createSyncEngineFromConfig(
        config,
        syncableStore,
        {},
        mek,
        syncSalt,
        vaultHeaderBytes,
        header.argon2Params,
        handleVaultMismatch,
      );
      if (engine) {
        syncEngineRef.current = engine;
        syncDisconnectRef.current = initSyncEngine(engine, storeRef.current);
      }

      // Trigger immediate sync to push local vault
      if (syncEngineRef.current) {
        await syncEngineRef.current.sync();
      }

      return { success: true };
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) };
    }
  }, [syncConfig, syncableStore, handleVaultMismatch]);

  const mergeRemoteVault = useCallback(async (): Promise<{
    success: boolean;
    error?: string;
    added?: number;
    updated?: number;
  }> => {
    try {
      const config = syncConfig;
      if (!config || config.provider === 'none' || !config.masterPassword)
        return { success: false, error: 'No sync configured or master password missing' };

      const urlPrefix = config.provider === 'webdav' && config.webdav ? config.webdav.url : null;
      await setSyncUrlPrefix(urlPrefix);

      const adapter = createAdapterFromConfig(config, {});
      if (!adapter) return { success: false, error: 'Could not create adapter' };

      // 1. Download and decrypt remote vault
      const { header: remoteHeader, encryptedItems } = await restoreFromCloudCore(
        adapter,
        config.masterPassword,
      );

      // 2. Decrypt remote items using a temporary store with the remote DEK
      const tempStore = createVaultStore();
      tempStore.getState().loadHeader(remoteHeader);
      await tempStore.getState().unlock(config.masterPassword, encryptedItems);
      const remoteItems = tempStore.getState().items;

      // 3. Merge remote items into local items (LWW)
      const localItems = storeRef.current.getState().items;
      const { merged, added, updated } = mergeItemSets(localItems, remoteItems);

      // 4. Replace local items with merged set (preserves original IDs and timestamps)
      storeRef.current.setState({ items: merged });

      // 5. Persist all merged items to local storage
      for (const item of merged) {
        const encrypted = storeRef.current.getState().encryptItem(item);
        await saveEncryptedItem(
          item.id,
          item.type,
          toBase64(encrypted),
          item.createdAt,
          item.updatedAt,
        );
      }

      // 6. Update UI
      syncItems();
      setVaultMismatchInfo(null);

      // 7. Re-create sync engine and trigger sync to push merged state
      syncDisconnectRef.current?.();
      syncDisconnectRef.current = null;
      syncEngineRef.current = null;

      const header = storeRef.current.getState().header!;
      const syncSalt = generateSyncSalt();
      const mek = await deriveMEK(config.masterPassword, syncSalt, header.argon2Params);
      const vaultHeaderBytes = serializeVaultHeader(header);

      const engine = createSyncEngineFromConfig(
        config,
        syncableStore,
        {},
        mek,
        syncSalt,
        vaultHeaderBytes,
        header.argon2Params,
        handleVaultMismatch,
      );
      if (engine) {
        syncEngineRef.current = engine;
        syncDisconnectRef.current = initSyncEngine(engine, storeRef.current);
      }

      return { success: true, added, updated };
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) };
    }
  }, [syncConfig, syncableStore, handleVaultMismatch, syncItems]);

  const initSyncAfterUnlock = useCallback(async () => {
    const dek = storeRef.current.getState().getDEK();
    const config = await loadSyncConfigFromFile(dek);
    setSyncConfig(config);
    setVaultMismatchInfo(null);

    if (config.provider === 'none' || !config.masterPassword) return;

    const urlPrefix = config.provider === 'webdav' && config.webdav ? config.webdav.url : null;
    await setSyncUrlPrefix(urlPrefix);

    const header = storeRef.current.getState().header!;
    const vaultHeaderBytes = serializeVaultHeader(header);

    const adapter = createAdapterFromConfig(config, {});
    const { mek, syncSalt } = await deriveMEKFromAdapter(
      adapter,
      config.masterPassword,
      header.argon2Params,
    );

    const engine = createSyncEngineFromConfig(
      config,
      syncableStore,
      {},
      mek,
      syncSalt,
      vaultHeaderBytes,
      header.argon2Params,
      handleVaultMismatch,
    );
    if (engine) {
      syncEngineRef.current = engine;
      syncDisconnectRef.current = initSyncEngine(engine, storeRef.current);
    }
  }, [syncableStore, handleVaultMismatch]);

  const unlock = useCallback(
    async (masterPassword: string) => {
      const storedItems = await loadAllEncryptedItems();
      const encryptedArrays = storedItems.map((item) => fromBase64(item.encrypted_data));
      await storeRef.current.getState().unlock(masterPassword, encryptedArrays);
      syncItems();
      setStatus('unlocked');
      try {
        await initSyncAfterUnlock();
      } catch (err) {
        console.warn('Sync initialization failed:', err instanceof Error ? err.message : err);
      }
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
      try {
        await initSyncAfterUnlock();
      } catch (err) {
        console.warn('Sync initialization failed:', err instanceof Error ? err.message : err);
      }
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
      try {
        await initSyncAfterUnlock();
      } catch (err) {
        console.warn('Sync initialization failed:', err instanceof Error ? err.message : err);
      }
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
    const header = storeRef.current.getState().header;
    if (!header) return false;
    try {
      await unlockVault(header, password);
      return true;
    } catch {
      return false;
    }
  }, []);

  const saveSyncConfigAction = useCallback(
    async (config: SyncConfig) => {
      const dek = storeRef.current.getState().getDEK();
      await saveSyncConfigToFile(config, dek);
      setSyncConfig(config);
      setVaultMismatchInfo(null);

      // Teardown old engine
      syncDisconnectRef.current?.();
      syncDisconnectRef.current = null;
      syncEngineRef.current = null;

      if (config.provider !== 'none' && config.masterPassword) {
        const urlPrefix = config.provider === 'webdav' && config.webdav ? config.webdav.url : null;
        await setSyncUrlPrefix(urlPrefix);

        const header = storeRef.current.getState().header!;
        const adapter = createAdapterFromConfig(config, {});
        const { mek, syncSalt } = await deriveMEKFromAdapter(
          adapter,
          config.masterPassword,
          header.argon2Params,
        );

        const engine = createSyncEngineFromConfig(
          config,
          syncableStore,
          {},
          mek,
          syncSalt,
          serializeVaultHeader(header),
          header.argon2Params,
          handleVaultMismatch,
        );
        if (engine) {
          syncEngineRef.current = engine;
          // Use connectSyncEngine (no immediate sync) instead of initSyncEngine
          // to avoid a race where the initial sync fires before the UI is ready.
          // The user can click "Sync Now" or sync will auto-trigger on item changes.
          syncDisconnectRef.current = connectSyncEngine(storeRef.current, engine);
        }
      } else {
        await setSyncUrlPrefix(null);
      }
    },
    [syncableStore, handleVaultMismatch],
  );

  const triggerSync = useCallback(async () => {
    const engine = syncEngineRef.current;
    if (!engine) return { lastSynced: null, error: 'No sync engine' };
    try {
      await engine.sync();
      const now = new Date().toISOString();
      return { lastSynced: now, error: null };
    } catch (e) {
      return { lastSynced: null, error: e instanceof Error ? e.message : String(e) };
    }
  }, []);

  const restoreFromCloudAction = useCallback(
    async (config: SyncConfig, masterPassword: string) => {
      try {
        // 1. Create adapter from config and set SSRF URL prefix
        const urlPrefix = config.provider === 'webdav' && config.webdav ? config.webdav.url : null;
        await setSyncUrlPrefix(urlPrefix);
        const adapter = createAdapterFromConfig(config, {});
        if (!adapter) throw new Error('Invalid sync config');

        // 2. Download and decrypt remote vault
        const { header, encryptedItems, itemCount, syncSalt, argon2Params } =
          await restoreFromCloudCore(adapter, masterPassword);

        // 3. Save vault header locally
        const serialized = serializeVaultHeader(header);
        await saveVaultHeader(toBase64(serialized));
        await setVaultSetupComplete(true);

        // 4. Create store, load header, unlock with password
        const store = createVaultStore();
        store.getState().loadHeader(header);
        await store.getState().unlock(masterPassword, encryptedItems);
        storeRef.current = store;

        // 5. Persist encrypted items to local storage
        for (const item of store.getState().items) {
          const encrypted = store.getState().encryptItem(item);
          await saveEncryptedItem(
            item.id,
            item.type,
            toBase64(encrypted),
            item.createdAt,
            item.updatedAt,
          );
        }

        // 6. Save sync config with master password
        const configWithPassword = { ...config, masterPassword };
        const dek = store.getState().getDEK();
        await saveSyncConfigToFile(configWithPassword, dek);
        setSyncConfig(configWithPassword);

        // 7. Derive MEK for sync engine
        const mek = await deriveMEK(masterPassword, syncSalt, argon2Params);

        // 8. Initialize sync engine
        const engine = createSyncEngineFromConfig(
          config,
          syncableStore,
          {},
          mek,
          syncSalt,
          serialized,
          argon2Params,
          handleVaultMismatch,
        );
        if (engine) {
          syncEngineRef.current = engine;
          syncDisconnectRef.current = initSyncEngine(engine, storeRef.current);
        }

        // 9. Update UI state
        setItems([...store.getState().items]);
        setStatus('unlocked');

        return { success: true, itemCount };
      } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : String(e) };
      }
    },
    [syncableStore, handleVaultMismatch],
  );

  const replaceLocalVault = useCallback(async (): Promise<{
    success: boolean;
    error?: string;
  }> => {
    try {
      const config = syncConfig;
      if (!config || config.provider === 'none' || !config.masterPassword)
        return { success: false, error: 'No sync configured or master password missing' };

      const result = await restoreFromCloudAction(config, config.masterPassword);
      if (result.success) {
        setVaultMismatchInfo(null);
      }
      return result;
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) };
    }
  }, [syncConfig, restoreFromCloudAction]);

  const resetVault = useCallback(async () => {
    // 0. Teardown sync engine
    syncDisconnectRef.current?.();
    syncDisconnectRef.current = null;
    syncEngineRef.current = null;
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
      for (const item of storedItems) {
        await deleteEncryptedItem(item.id);
      }
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
      syncEngineRef.current?.recordTombstone(id);
      syncItems();
    },
    [syncItems],
  );

  const search = useCallback((query: string): VaultItem[] => {
    return storeRef.current.getState().search(query);
  }, []);

  // Auto-lock when window is hidden for too long (Page Visibility API).
  // Uses a timer instead of checking elapsed on visibility return to avoid
  // false triggers from brief visibility changes (e.g., automation tools).
  const autoLockTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden' && status === 'unlocked') {
        // Start a timer — if the window stays hidden long enough, lock.
        if (!autoLockTimer.current) {
          autoLockTimer.current = setTimeout(() => {
            autoLockTimer.current = null;
            // Only lock if still hidden and still unlocked when the timer fires
            if (document.visibilityState === 'hidden' && status === 'unlocked') {
              lock();
            }
          }, AUTO_LOCK_TIMEOUT_MS);
        }
      } else if (document.visibilityState === 'visible') {
        // Window came back — cancel the timer
        if (autoLockTimer.current) {
          clearTimeout(autoLockTimer.current);
          autoLockTimer.current = null;
        }
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      if (autoLockTimer.current) {
        clearTimeout(autoLockTimer.current);
        autoLockTimer.current = null;
      }
    };
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
        validateMasterPassword,
        saveSyncConfig: saveSyncConfigAction,
        triggerSync,
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
