/**
 * Zustand vanilla store for vault state management.
 *
 * Uses zustand/vanilla so it works in React, React Native, and plain TS.
 *
 * SECURITY: The DEK is held in a closure variable, never in the serializable
 * state object. When lock() is called, the closure variable is zeroed out.
 */

import { createStore } from 'zustand/vanilla';
import { v4 as uuidv4 } from 'uuid';
import type { VaultItem } from '../models/vault-item.js';
import type { VaultHeader } from '../crypto/vault-header.js';
import { unlockVault, unlockVaultWithRecovery } from '../crypto/vault-header.js';
import { encrypt, decrypt } from '../crypto/encryption.js';
import { VaultItemSchema } from '../models/vault-item.js';

export type VaultStatus = 'locked' | 'unlocked';

export type VaultState = {
  status: VaultStatus;
  items: VaultItem[];
  header: VaultHeader | null;
};

export type VaultActions = {
  /** Load a vault header (e.g., from disk). Does not unlock. */
  loadHeader: (header: VaultHeader) => void;

  /** Unlock vault with master password. Decrypts all items. */
  unlock: (masterPassword: string, encryptedItems: Uint8Array[]) => Promise<void>;

  /** Unlock vault with recovery key. Decrypts all items. */
  unlockWithRecovery: (recoveryKey: string, encryptedItems: Uint8Array[]) => Promise<void>;

  /** Unlock vault with a pre-derived DEK (used by PIN unlock). */
  unlockWithDEK: (dek: Uint8Array, encryptedItems: Uint8Array[]) => void;

  /** Lock vault: clear DEK and all decrypted items from memory. */
  lock: () => void;

  /** Add a new vault item. Returns the generated UUID. */
  addItem: (item: Omit<VaultItem, 'id' | 'createdAt' | 'updatedAt'>) => string;

  /** Update an existing vault item by ID. */
  updateItem: (id: string, updates: Partial<Omit<VaultItem, 'id' | 'type' | 'createdAt'>>) => void;

  /** Delete a vault item by ID. */
  deleteItem: (id: string) => void;

  /** Search items by query (case-insensitive substring match on name, url, username). */
  search: (query: string) => VaultItem[];

  /** Encrypt a vault item with the current DEK. Throws if locked. */
  encryptItem: (item: VaultItem) => Uint8Array;

  /** Get a reference to the current DEK (for operations like password change). Throws if locked. */
  getDEK: () => Uint8Array;
};

export type VaultStore = VaultState & VaultActions;

/**
 * Create a vault store instance.
 *
 * The DEK is held in a closure — never exposed in the state tree.
 */
export function createVaultStore() {
  /** The DEK lives here — in a closure, not in state. */
  let activeDEK: Uint8Array | null = null;

  function requireUnlocked(): Uint8Array {
    if (!activeDEK) {
      throw new Error('Vault is locked');
    }
    return activeDEK;
  }

  function decryptItems(dek: Uint8Array, encryptedItems: Uint8Array[]): VaultItem[] {
    const items: VaultItem[] = [];
    for (const encBytes of encryptedItems) {
      try {
        const plainBytes = decrypt(encBytes, dek);
        const json = new TextDecoder().decode(plainBytes);
        const parsed = JSON.parse(json) as unknown;
        items.push(VaultItemSchema.parse(parsed));
      } catch (e) {
        // Skip corrupted items rather than crashing the entire vault
        console.warn(
          'Failed to decrypt/parse vault item, skipping:',
          e instanceof Error ? e.message : e,
        );
      }
    }
    return items;
  }

  return createStore<VaultStore>()((set, get) => ({
    // State
    status: 'locked' as VaultStatus,
    items: [],
    header: null,

    // Actions
    loadHeader: (header: VaultHeader) => {
      set({ header });
    },

    unlock: async (masterPassword: string, encryptedItems: Uint8Array[]) => {
      const { header } = get();
      if (!header) {
        throw new Error('No vault header loaded');
      }

      const dek = await unlockVault(header, masterPassword);
      activeDEK = dek;

      const items = decryptItems(dek, encryptedItems);
      set({ status: 'unlocked', items });
    },

    unlockWithRecovery: async (recoveryKey: string, encryptedItems: Uint8Array[]) => {
      const { header } = get();
      if (!header) {
        throw new Error('No vault header loaded');
      }

      const dek = await unlockVaultWithRecovery(header, recoveryKey);
      activeDEK = dek;

      const items = decryptItems(dek, encryptedItems);
      set({ status: 'unlocked', items });
    },

    unlockWithDEK: (dek: Uint8Array, encryptedItems: Uint8Array[]) => {
      activeDEK = dek;
      const items = decryptItems(dek, encryptedItems);
      set({ status: 'unlocked', items });
    },

    lock: () => {
      // Zero out the DEK
      if (activeDEK) {
        activeDEK.fill(0);
        activeDEK = null;
      }
      set({ status: 'locked', items: [] });
    },

    addItem: (itemData: Omit<VaultItem, 'id' | 'createdAt' | 'updatedAt'>) => {
      requireUnlocked();

      const now = new Date().toISOString();
      const id = uuidv4();
      const newItem = {
        ...itemData,
        id,
        createdAt: now,
        updatedAt: now,
      } as VaultItem;

      // Validate through Zod
      VaultItemSchema.parse(newItem);

      set((state) => ({ items: [...state.items, newItem] }));
      return id;
    },

    updateItem: (id: string, updates: Partial<Omit<VaultItem, 'id' | 'type' | 'createdAt'>>) => {
      requireUnlocked();

      const now = new Date().toISOString();

      set((state) => ({
        items: state.items.map((item) => {
          if (item.id !== id) return item;
          const updated = { ...item, ...updates, updatedAt: now };
          // Validate the updated item
          VaultItemSchema.parse(updated);
          return updated as VaultItem;
        }),
      }));
    },

    deleteItem: (id: string) => {
      requireUnlocked();

      set((state) => ({
        items: state.items.filter((item) => item.id !== id),
      }));
    },

    search: (query: string) => {
      requireUnlocked();

      // Limit query length to prevent performance issues
      const lower = query.slice(0, 256).toLowerCase();
      return get().items.filter((item) => {
        // Search across name
        if (item.name.toLowerCase().includes(lower)) return true;
        // For credentials, also search url and username
        if (item.type === 'credential') {
          if (item.url?.toLowerCase().includes(lower)) return true;
          if (item.username.toLowerCase().includes(lower)) return true;
          if (item.appIdentifiers?.some((id) => id.toLowerCase().includes(lower))) return true;
        }
        // Search tags
        if (item.tags.some((tag) => tag.toLowerCase().includes(lower))) return true;
        return false;
      });
    },

    encryptItem: (item: VaultItem) => {
      const dek = requireUnlocked();
      const json = JSON.stringify(item);
      const bytes = new TextEncoder().encode(json);
      return encrypt(bytes, dek);
    },

    getDEK: () => {
      return requireUnlocked();
    },
  }));
}
