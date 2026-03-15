import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';
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
import { createDesktopBiometricAdapter } from './desktop-biometric-adapter';
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
} from './keyring-storage';

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}

function fromBase64(b64: string): Uint8Array {
  if (!b64 || typeof b64 !== 'string') {
    throw new Error('Invalid base64 input');
  }
  try {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  } catch {
    throw new Error('Invalid base64 data');
  }
}

type Store = ReturnType<typeof createVaultStore>;

/** Auto-lock after 5 minutes of window being hidden */
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
    storeRef.current.getState().loadHeader(header);
    setStatus('locked');
    const pinDataRaw = await loadPinDataFromKeyring();
    setPinConfigured(pinDataRaw !== null);
    const available = await biometricAdapterRef.current.isAvailable();
    setBiometricAvailable(available);
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

  const unlock = useCallback(
    async (masterPassword: string) => {
      const storedItems = await loadAllEncryptedItems();
      const encryptedArrays = storedItems.map((item) => fromBase64(item.encrypted_data));
      await storeRef.current.getState().unlock(masterPassword, encryptedArrays);
      syncItems();
      setStatus('unlocked');
    },
    [syncItems],
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
      return { success: true, attemptsRemaining: MAX_PIN_ATTEMPTS };
    },
    [syncItems],
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
    } else if (result.status === 'invalidated') {
      await biometricAdapterRef.current.clearDEK();
    }
    return result;
  }, [syncItems]);

  const enableBiometric = useCallback(async () => {
    const dek = storeRef.current.getState().getDEK();
    await biometricAdapterRef.current.saveDEK(dek);
  }, []);

  const disableBiometric = useCallback(async () => {
    await biometricAdapterRef.current.clearDEK();
  }, []);

  const lock = useCallback(() => {
    storeRef.current.getState().lock();
    setItems([]);
    setStatus('locked');
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
      syncItems();
    },
    [syncItems],
  );

  const search = useCallback((query: string): VaultItem[] => {
    return storeRef.current.getState().search(query);
  }, []);

  // Auto-lock when window is hidden for too long (Page Visibility API)
  const hiddenAt = useRef<number | null>(null);
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAt.current = Date.now();
      } else if (document.visibilityState === 'visible' && hiddenAt.current !== null) {
        const elapsed = Date.now() - hiddenAt.current;
        hiddenAt.current = null;
        if (elapsed >= AUTO_LOCK_TIMEOUT_MS && status === 'unlocked') {
          lock();
        }
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
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
        pinConfigured,
        unlockWithPin,
        enablePin,
        disablePin,
        biometricAvailable,
        unlockWithBiometric,
        enableBiometric,
        disableBiometric,
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
