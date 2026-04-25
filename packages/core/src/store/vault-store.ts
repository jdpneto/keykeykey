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

export type VaultItemType = VaultItem['type'];

export interface SearchOptions {
  /** Restrict results to these item types. Default: all types. */
  types?: VaultItemType[];
  /**
   * When true, also match the type-specific deep fields (notes / content /
   * card details). Default false.
   */
  deepFields?: boolean;
}

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

  /** Reset vault: zero DEK, clear items, clear header. Status → 'locked'. */
  resetVault: () => void;

  /** Add a new vault item. Returns the generated UUID. */
  addItem: (item: Omit<VaultItem, 'id' | 'createdAt' | 'updatedAt'>) => string;

  /** Add multiple vault items at once. Returns generated UUIDs. */
  addItems: (items: Omit<VaultItem, 'id' | 'createdAt' | 'updatedAt'>[]) => string[];

  /** Update an existing vault item by ID. */
  updateItem: (id: string, updates: Partial<Omit<VaultItem, 'id' | 'type' | 'createdAt'>>) => void;

  /** Delete a vault item by ID. */
  deleteItem: (id: string) => void;

  /**
   * Search items by query (case-insensitive substring match).
   *
   * Default (shallow) fields searched on every item type: `name`, `tags`.
   * Credentials additionally search: `url`, `username`, `appIdentifiers`.
   *
   * `options.types` restricts the result to one or more item types — pass the
   * active vault tab's filter to scope results in a single pass instead of
   * post-filtering.
   *
   * `options.deepFields` opts into type-specific extra fields:
   *   - credential: `notes`
   *   - card: `cardholderName`, `number`, `notes` (NOT `cvv`, NOT `pin`)
   *   - secure-note: `content`
   * The Cards and Notes tabs pass `deepFields: true` so a user looking inside
   * a specific tab can search the full body (note content, card details). The
   * default-off shallow set keeps the global "All" search intentionally
   * narrow (passwords-focused — see implementationplan.md §11).
   */
  search: (query: string, options?: SearchOptions) => VaultItem[];

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

    resetVault: () => {
      if (activeDEK) {
        activeDEK.fill(0);
        activeDEK = null;
      }
      set({ status: 'locked', items: [], header: null });
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

      // Validate through Zod (use parsed result so defaults like passwordHistory are applied)
      const parsedItem = VaultItemSchema.parse(newItem) as VaultItem;

      set((state) => ({ items: [...state.items, parsedItem] }));
      return id;
    },

    addItems: (itemsData: Omit<VaultItem, 'id' | 'createdAt' | 'updatedAt'>[]) => {
      requireUnlocked();
      const now = new Date().toISOString();
      const parsedItems: VaultItem[] = [];
      const ids: string[] = [];

      for (const itemData of itemsData) {
        const id = uuidv4();
        ids.push(id);
        const newItem = { ...itemData, id, createdAt: now, updatedAt: now } as VaultItem;
        parsedItems.push(VaultItemSchema.parse(newItem) as VaultItem);
      }

      set((state) => ({ items: [...state.items, ...parsedItems] }));
      return ids;
    },

    updateItem: (id: string, updates: Partial<Omit<VaultItem, 'id' | 'type' | 'createdAt'>>) => {
      requireUnlocked();

      const now = new Date().toISOString();

      set((state) => ({
        items: state.items.map((item) => {
          if (item.id !== id) return item;

          const mergedUpdates: Record<string, unknown> = { ...updates, updatedAt: now };

          // Track password history for credentials
          if (
            item.type === 'credential' &&
            'password' in updates &&
            updates.password !== undefined &&
            updates.password !== item.password
          ) {
            const historyEntry = { password: item.password, changedAt: now };
            const currentHistory = item.passwordHistory ?? [];
            const newHistory = [...currentHistory, historyEntry].slice(-20);
            mergedUpdates.passwordHistory = newHistory;
          }

          const updated = { ...item, ...mergedUpdates };
          // Validate the updated item (use parsed result so defaults are applied)
          return VaultItemSchema.parse(updated) as VaultItem;
        }),
      }));
    },

    deleteItem: (id: string) => {
      requireUnlocked();

      set((state) => ({
        items: state.items.filter((item) => item.id !== id),
      }));
    },

    search: (query: string, options?: SearchOptions) => {
      requireUnlocked();

      // Limit query length to prevent performance issues
      const lower = query.slice(0, 256).toLowerCase();
      const typeFilter = options?.types;
      const deep = options?.deepFields === true;

      return get().items.filter((item) => {
        if (typeFilter && !typeFilter.includes(item.type)) return false;

        // Shallow fields — searched on every item type.
        if (item.name.toLowerCase().includes(lower)) return true;
        if (item.tags.some((tag) => tag.toLowerCase().includes(lower))) return true;

        // Type-specific shallow fields.
        if (item.type === 'credential') {
          if (item.url?.toLowerCase().includes(lower)) return true;
          if (item.username.toLowerCase().includes(lower)) return true;
          if (item.appIdentifiers?.some((id) => id.toLowerCase().includes(lower))) return true;
        }

        // Deep fields — only when the caller opts in (Cards/Notes tabs).
        if (deep) {
          if (item.type === 'credential') {
            if (item.notes?.toLowerCase().includes(lower)) return true;
          } else if (item.type === 'card') {
            if (item.cardholderName.toLowerCase().includes(lower)) return true;
            if (item.number.toLowerCase().includes(lower)) return true;
            if (item.notes?.toLowerCase().includes(lower)) return true;
            // cvv and pin are intentionally NOT indexed.
          } else if (item.type === 'secure-note') {
            if (item.content.toLowerCase().includes(lower)) return true;
          }
        }

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
