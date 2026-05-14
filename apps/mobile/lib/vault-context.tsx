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
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createVaultStore,
  createVaultHeader,
  serializeVaultHeader,
  deserializeVaultHeader,
  generateRecoveryKey,
  ARGON2_PRESETS,
  type VaultItem,
  type SearchOptions,
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
  closeDB,
  deleteEncryptedItem,
  deleteAllEncryptedItems,
  deleteVaultHeader,
  deleteBiometricDEK,
  loadBiometricDEKFingerprint,
  setBiometricEnabledFlag,
  isBiometricEnabled,
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
import { dekFingerprint } from './dek-fingerprint';
import type {
  SyncConfig,
  SyncableStore,
  VaultMismatchInfo,
  RestoreProgressEvent,
} from '@keykeykey/core/sync';
import { SyncLifecycle } from '@keykeykey/core/sync';
import { createMobilePlatformStorage, clearSyncConfigData } from './sync';
import { useAutoLockSetting } from './use-auto-lock-setting';

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
  restorePasswordFromHistory: (id: string, historyIndex: number) => Promise<void>;
  removeItem: (id: string) => Promise<void>;
  search: (query: string, options?: SearchOptions) => VaultItem[];
  initialize: () => Promise<void>;
  /** Device has biometric hardware and the user has enrolled at least one credential. */
  biometricAvailable: boolean;
  /** User has opted in to biometric unlock (DEK is wrapped in the OS keystore). */
  biometricEnabled: boolean;
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
  lastSynced: string | null;
  getSyncStatus: () => { isSyncing: boolean };
  saveSyncConfig: (config: SyncConfig) => Promise<void>;
  triggerSync: () => Promise<{
    lastSynced: string | null;
    error: string | null;
    mismatchInfo?: VaultMismatchInfo | null;
  }>;
  validateMasterPassword: (password: string) => Promise<boolean>;
  vaultMismatchInfo: VaultMismatchInfo | null;
  /**
   * Stable getter that reads the *current* mismatchInfo straight from the
   * SyncLifecycle — used by sync.tsx's driver so `refreshStatus()` after a
   * mid-flight `triggerSync()` sees the freshly-detected mismatch instead of
   * the pre-trigger React state captured in its closure. The React state
   * (`vaultMismatchInfo`) is still the source of truth for rendering — this
   * getter exists solely to bypass the closure-capture window.
   */
  getMismatchInfoNow: () => VaultMismatchInfo | null;
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
  setAutoLockMinutes: (minutes: number) => Promise<void>;
  onActivity: () => void;
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
  const [biometricEnabled, setBiometricEnabled] = useState(false);
  const [pinConfigured, setPinConfigured] = useState(false);
  const [quickUnlockPromptShown, setQuickUnlockPromptShownState] = useState(true);
  const [syncConfig, setSyncConfig] = useState<SyncConfig | null>(null);
  // Mirrors desktop's localStorage-backed `lastSynced`. AsyncStorage
  // is the mobile equivalent; initialize from storage on mount and
  // persist each successful triggerSync result so the Cloud Sync
  // screen can surface "Last synced: HH:MM:SS" across navigations
  // and cold starts.
  const LAST_SYNCED_KEY = 'keykeykey_lastSynced';
  const [lastSynced, setLastSyncedState] = useState<string | null>(null);
  useEffect(() => {
    AsyncStorage.getItem(LAST_SYNCED_KEY)
      .then((v) => setLastSyncedState(v))
      .catch(() => {});
  }, []);
  const setLastSynced = useCallback((value: string | null) => {
    setLastSyncedState(value);
    if (value) {
      AsyncStorage.setItem(LAST_SYNCED_KEY, value).catch(() => {});
    } else {
      AsyncStorage.removeItem(LAST_SYNCED_KEY).catch(() => {});
    }
  }, []);
  const [vaultMismatchInfo, setVaultMismatchInfo] = useState<VaultMismatchInfo | null>(null);
  const lifecycleRef = useRef<SyncLifecycle | null>(null);
  const { autoLockMinutes, setAutoLockMinutes, loading: autoLockLoading } = useAutoLockSetting();
  const onActivityRef = useRef<(() => void) | null>(null);

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
    setBiometricEnabled(await isBiometricEnabled());
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

  /**
   * Preventative auto-heal: if PIN / biometric data exists and carries a
   * DEK fingerprint that doesn't match the DEK we just unlocked with,
   * wipe it. The wrap was pointing at a pre-restore DEK — leaving it in
   * place would make the autofill appex decrypt everything as garbage
   * and fall into the dek-mismatch alert. After a master-password unlock
   * we know the currently-correct DEK, so we can validate both wraps
   * without needing the PIN or biometric itself.
   *
   * Legacy pin_data / biometric_dek payloads written before this field
   * was added carry no fingerprint — we treat them as unknown and leave
   * them untouched. Users who re-enable quick-unlock after upgrading
   * get the fingerprint stamped and auto-heal going forward.
   */
  const reconcileQuickUnlockFingerprints = useCallback(async (currentDek: Uint8Array) => {
    const expected = dekFingerprint(currentDek);

    try {
      const pinRaw = await loadPinDataStorage();
      if (pinRaw) {
        const parsed = JSON.parse(pinRaw) as { dekFingerprint?: string };
        if (typeof parsed.dekFingerprint === 'string' && parsed.dekFingerprint !== expected) {
          console.warn('[vault] pin_data DEK fingerprint mismatch — clearing');
          await deletePinData();
          await deletePinAttempts();
          setPinConfigured(false);
        }
      }
    } catch (err) {
      console.warn('[vault] pin fingerprint check failed:', err);
    }

    try {
      // Read the NON-protected sibling fingerprint (not the biometric
      // DEK itself, which would trigger a Face ID prompt). If it's
      // present and doesn't match, the biometric wrap is stale — clear
      // it so the appex falls back to master-password instead of
      // decrypting the vault into nothing.
      const storedFingerprint = await loadBiometricDEKFingerprint();
      if (storedFingerprint !== null && storedFingerprint !== expected) {
        console.warn('[vault] biometric_dek fingerprint mismatch — clearing');
        await deleteBiometricDEK();
        await setBiometricEnabledFlag(false);
        setBiometricEnabled(false);
      }
    } catch (err) {
      console.warn('[vault] biometric fingerprint check failed:', err);
    }
  }, []);

  const unlock = useCallback(
    async (masterPassword: string) => {
      const storedItems = await loadAllEncryptedItems();
      const encryptedArrays = storedItems.map((item) => fromBase64(item.encrypted_data));
      await storeRef.current.getState().unlock(masterPassword, encryptedArrays);
      syncItems();
      setStatus('unlocked');
      try {
        await reconcileQuickUnlockFingerprints(storeRef.current.getState().getDEK());
      } catch {
        /* best-effort */
      }
      await initSyncAfterUnlock();
    },
    [syncItems, initSyncAfterUnlock, reconcileQuickUnlockFingerprints],
  );

  const unlockWithBiometric = useCallback(async (): Promise<BiometricResult> => {
    const result = await biometricAdapter.current.loadDEK();
    if (result.status === 'invalidated') {
      await biometricAdapter.current.clearDEK().catch(() => {});
      await setBiometricEnabledFlag(false).catch(() => {});
      setBiometricEnabled(false);
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
    await setBiometricEnabledFlag(true);
    setBiometricEnabled(true);
  }, []);

  const disableBiometric = useCallback(async () => {
    await biometricAdapter.current.clearDEK();
    await setBiometricEnabledFlag(false);
    setBiometricEnabled(false);
  }, []);

  const enablePin = useCallback(async (pin: string) => {
    const dek = storeRef.current.getState().getDEK();
    const pinData = await setupPin(pin, dek);
    const serialized = JSON.stringify({
      wrappedDEK: toBase64(pinData.wrappedDEK),
      salt: toBase64(pinData.salt),
      // Short SHA-256 fingerprint of the DEK we just wrapped. Lets the main
      // app detect on later master-password unlock whether the pin_data is
      // stale (wrapping a DEK that no longer matches the current vault —
      // e.g. after a cloud restore rotates the header) and auto-clear it,
      // instead of leaving the autofill appex to hit the dek-mismatch
      // branch. 8-byte prefix of SHA-256 gives ~64 bits of collision
      // resistance, which is plenty for "same DEK" identity.
      dekFingerprint: dekFingerprint(dek),
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
    setLastSynced(null);
    setVaultMismatchInfo(null);
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
      await setBiometricEnabledFlag(false);
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
    setBiometricEnabled(false);
  }, [setLastSynced]);

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

  const restorePasswordFromHistory = useCallback(
    async (id: string, historyIndex: number) => {
      storeRef.current.getState().restorePasswordFromHistory(id, historyIndex);
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
  }, [setLastSynced]);

  const clearVaultMismatch = useCallback(async () => {
    const lifecycle = lifecycleRef.current;
    if (lifecycle) {
      await lifecycle.clearMismatch();
    }
  }, []);

  const getMismatchInfoNow = useCallback(() => lifecycleRef.current?.mismatchInfo ?? null, []);

  // mergeVaults / replaceRemote / replaceLocal each end with a completed
  // 'await'-mode engine sync that uploads the resolved vault, so semantically
  // the remote is up-to-date as of "now" — but the lifecycle doesn't
  // propagate that timestamp back through its return value. Without a
  // lastSynced update here the Connected card stays blank after conflict
  // resolution (and Maestro's sync-status testID lives on that "Last synced"
  // line, so flows can't assert on it). Set lastSynced locally on success.
  const replaceRemoteVault = useCallback(async (): Promise<{
    success: boolean;
    error?: string;
  }> => {
    const lifecycle = lifecycleRef.current;
    if (!lifecycle) return { success: false, error: 'No sync lifecycle' };
    const result = await lifecycle.replaceRemote();
    if (result.success) setLastSynced(new Date().toISOString());
    return result;
  }, [setLastSynced]);

  const mergeRemoteVault = useCallback(async (): Promise<{
    success: boolean;
    error?: string;
    added?: number;
    updated?: number;
  }> => {
    const lifecycle = lifecycleRef.current;
    if (!lifecycle) return { success: false, error: 'No sync lifecycle' };
    const result = await lifecycle.mergeVaults();
    if (result.success) setLastSynced(new Date().toISOString());
    return result;
  }, [setLastSynced]);

  // Invalidate PIN + biometric data after a restore. Both wrap the vault DEK,
  // and a restore writes a new header which derives a different DEK. Without
  // this cleanup the wrapping is stale: PIN unlock would succeed (AEAD tag
  // valid under the old DEK) but return a DEK that cannot decrypt the newly-
  // restored items, so the iOS credential-provider appex (and any other
  // PIN/biometric caller) would show an empty vault. User must re-enable
  // quick-unlock from Settings after a restore — safer than silently
  // re-wrapping because the user may have forgotten the PIN, or the
  // biometric enrollment may have changed.
  const invalidateQuickUnlockAfterRestore = useCallback(async () => {
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
    try {
      await deleteBiometricDEK();
    } catch {
      /* ignore */
    }
    try {
      await setBiometricEnabledFlag(false);
    } catch {
      /* ignore */
    }
    setPinConfigured(false);
    setBiometricEnabled(false);
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
      await invalidateQuickUnlockAfterRestore();
      setLastSynced(new Date().toISOString());
    }
    return result;
  }, [getOrCreateLifecycle, setLastSynced, invalidateQuickUnlockAfterRestore]);

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
        await invalidateQuickUnlockAfterRestore();
      }
      return result;
    },
    [getOrCreateLifecycle, invalidateQuickUnlockAfterRestore],
  );

  const search = useCallback((query: string, options?: SearchOptions): VaultItem[] => {
    return storeRef.current.getState().search(query, options);
  }, []);

  // Auto-lock after inactivity. Resets on touch (via onActivityRef) and
  // AppState changes.
  //
  // Background/foreground handling: when the user invokes the iOS autofill
  // credential-provider appex from another app (e.g. Firefox), the main app
  // is backgrounded. We freeze the timer at background and record the
  // timestamp so that on foreground we can decide in ONE render whether
  // enough time has passed to lock (without a JS setTimeout firing in the
  // suspended runtime racing against the re-render). This avoids the bug
  // where the timer fires on the first post-foreground tick, `lock()` sets
  // `items = []`, and the Vault tab shows an empty-state before the router
  // guard can kick in.
  useEffect(() => {
    if (status !== 'unlocked' || autoLockMinutes === 0 || autoLockLoading) return;

    const ms = autoLockMinutes * 60 * 1000;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let backgroundedAt: number | null = null;

    const arm = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(lock, ms);
    };

    let lastReset = 0;
    const reset = () => {
      const now = Date.now();
      if (now - lastReset < 1000) return;
      lastReset = now;
      arm();
    };

    arm();

    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'background' || state === 'inactive') {
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        backgroundedAt = Date.now();
        return;
      }
      if (state === 'active') {
        const elapsed = backgroundedAt ? Date.now() - backgroundedAt : 0;
        backgroundedAt = null;
        if (elapsed >= ms) {
          // Exceeded the inactivity window while backgrounded — lock
          // synchronously. The router guard in RootLayoutInner picks up
          // the status change and routes to /unlock before any empty-state
          // Vault render can flash.
          lock();
          return;
        }
        reset();
      }
    });

    onActivityRef.current = reset;

    return () => {
      if (timer) clearTimeout(timer);
      sub.remove();
      onActivityRef.current = null;
    };
  }, [status, autoLockMinutes, autoLockLoading, lock]);

  // Defensive re-read on foreground. If the vault is unlocked when the app
  // comes back to active, drop the cached SQLite handle (the appex may have
  // had the DB open in a different process while we were backgrounded),
  // re-query the encrypted items from disk, and push them through the vault
  // store with the same DEK. Protects against in-memory drift (we saw a
  // case where `items` appeared empty while the DB had 507 rows — a stale
  // JS state after the user went to Firefox, used the autofill appex, and
  // returned).
  useEffect(() => {
    if (status !== 'unlocked') return;
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'background' || state === 'inactive') {
        // Force the next query to open a fresh DB handle.
        closeDB().catch(() => {});
        return;
      }
      if (state !== 'active') return;
      const store = storeRef.current?.getState();
      if (!store || store.status !== 'unlocked') return;
      let dek: Uint8Array;
      try {
        dek = store.getDEK();
      } catch {
        // Store drifted out of unlocked mid-race; the auto-lock effect or
        // the root-layout guard handles it from here.
        return;
      }
      loadAllEncryptedItems()
        .then((stored) => {
          const encryptedArrays = stored.map((i) => fromBase64(i.encrypted_data));
          const current = storeRef.current?.getState();
          if (!current || current.status !== 'unlocked') return;
          current.unlockWithDEK(dek, encryptedArrays);
          syncItems();
        })
        .catch((err) => {
          console.warn('[vault] foreground reload failed:', err);
        });
    });
    return () => sub.remove();
  }, [status, syncItems]);

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
        restorePasswordFromHistory,
        removeItem,
        search,
        initialize,
        biometricAvailable,
        biometricEnabled,
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
        lastSynced,
        getSyncStatus,
        saveSyncConfig: saveSyncConfigAction,
        triggerSync,
        validateMasterPassword,
        vaultMismatchInfo,
        getMismatchInfoNow,
        clearVaultMismatch,
        replaceRemoteVault,
        mergeRemoteVault,
        replaceLocalVault,
        restoreFromCloud: restoreFromCloudAction,
        autoLockMinutes,
        setAutoLockMinutes,
        onActivity: () => onActivityRef.current?.(),
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
