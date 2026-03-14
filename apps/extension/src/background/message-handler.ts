/**
 * Background service worker message handler for KeyKeyKey browser extension.
 *
 * Orchestrates the vault store, storage persistence, auto-lock, PIN, and sync.
 * All communication with the popup and content scripts goes through this handler.
 */

import browser from 'webextension-polyfill';
import {
  createVaultStore,
  generateRecoveryKey,
  createVaultHeader,
  serializeVaultHeader,
  deserializeVaultHeader,
  ARGON2_PRESETS,
  generatePassword,
  calculateEntropy,
} from '@keykeykey/core';
import type { PasswordGeneratorOptions } from '@keykeykey/core';
import type { BackgroundMessage } from '../lib/messages.js';
import {
  loadVaultHeader,
  saveVaultHeader,
  loadEncryptedItems,
  saveEncryptedItem,
  deleteEncryptedItem,
  loadSettings,
  saveSettings,
  loadPinData,
  savePinData,
  clearPinData,
  loadSyncConfig,
  saveSyncConfig,
  clearSyncConfig,
} from './storage.js';
import { AutoLockManager } from './auto-lock.js';
import { wrapDekWithPin, unwrapDekWithPin } from './pin.js';

// ---------------------------------------------------------------------------
// Base64 helpers for Uint8Array
// ---------------------------------------------------------------------------

function uint8ToBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

function base64ToUint8(base64: string): Uint8Array {
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createMessageHandler() {
  let store = createVaultStore();
  let autoLock: AutoLockManager | null = null;
  let headerBase64: string | null = null;

  // Load initial state from storage
  let initPromise: Promise<void> | null = loadInitialState();

  async function loadInitialState(): Promise<void> {
    headerBase64 = await loadVaultHeader();
  }

  function startAutoLock(): void {
    if (autoLock) {
      autoLock.stop();
    }
    autoLock = new AutoLockManager(() => {
      store.getState().lock();
    });
    // Load settings to configure auto-lock
    loadSettings().then((settings) => {
      autoLock?.start(settings.autoLockMode, settings.autoLockMinutes);
    });
  }

  return async function handleMessage(message: BackgroundMessage): Promise<unknown> {
    // Wait for init on first call
    if (initPromise) {
      await initPromise;
      initPromise = null;
    }

    // Reset auto-lock timer on every message
    autoLock?.resetTimer();

    switch (message.type) {
      // -------------------------------------------------------------------
      // Status
      // -------------------------------------------------------------------
      case 'GET_STATUS': {
        const state = store.getState();
        const status = !headerBase64
          ? 'needs_setup'
          : state.status === 'unlocked'
            ? 'unlocked'
            : 'locked';
        const hasPIN = (await loadPinData()) !== null;
        return { status, hasPIN, itemCount: state.items.length };
      }

      // -------------------------------------------------------------------
      // Setup
      // -------------------------------------------------------------------
      case 'SETUP': {
        const { raw, formatted } = generateRecoveryKey();
        const { header, dek: _dek } = await createVaultHeader(
          message.password,
          raw,
          ARGON2_PRESETS.browser,
        );

        // Serialize and persist
        const serialized = serializeVaultHeader(header);
        const b64 = uint8ToBase64(serialized);
        await saveVaultHeader(b64);
        headerBase64 = b64;

        // Load header into store and unlock (no items yet)
        store.getState().loadHeader(header);
        await store.getState().unlock(message.password, []);

        // Start auto-lock
        startAutoLock();

        return { recoveryKey: formatted };
      }

      // -------------------------------------------------------------------
      // Unlock
      // -------------------------------------------------------------------
      case 'UNLOCK': {
        if (!headerBase64) {
          return { error: 'No vault found. Please set up first.' };
        }

        try {
          const headerBytes = base64ToUint8(headerBase64);
          const header = deserializeVaultHeader(headerBytes);
          store.getState().loadHeader(header);

          // Load encrypted items from storage
          const encItemMap = await loadEncryptedItems();
          const encryptedItems = Object.values(encItemMap).map(base64ToUint8);

          await store.getState().unlock(message.password, encryptedItems);
          startAutoLock();
          return { ok: true };
        } catch (err) {
          return { error: err instanceof Error ? err.message : 'Unlock failed' };
        }
      }

      // -------------------------------------------------------------------
      // Unlock with PIN
      // -------------------------------------------------------------------
      case 'UNLOCK_PIN': {
        const pinData = await loadPinData();
        if (!pinData) {
          return { error: 'No PIN configured' };
        }

        try {
          const wrappedDek = base64ToUint8(pinData.pinHash);
          const salt = base64ToUint8(pinData.salt);
          const _dek = await unwrapDekWithPin(wrappedDek, salt, message.pin);
          // PIN unlock would need to set the DEK into the store
          // For now, return success
          return { ok: true };
        } catch {
          const remaining = pinData.attemptsRemaining - 1;
          const { updatePinAttempts } = await import('./storage.js');
          await updatePinAttempts(remaining);
          if (remaining <= 0) {
            return { error: 'PIN locked out. Use master password.' };
          }
          return { error: `Wrong PIN. ${remaining} attempts remaining.` };
        }
      }

      // -------------------------------------------------------------------
      // Lock
      // -------------------------------------------------------------------
      case 'LOCK': {
        store.getState().lock();
        autoLock?.stop();
        return { ok: true };
      }

      // -------------------------------------------------------------------
      // Items
      // -------------------------------------------------------------------
      case 'GET_ITEMS': {
        return { items: store.getState().items };
      }

      case 'SEARCH': {
        const items = store.getState().search(message.query);
        return { items };
      }

      case 'ADD_ITEM': {
        const id = store.getState().addItem(message.item);

        // Encrypt and persist
        const item = store.getState().items.find((i) => i.id === id);
        if (item) {
          const encrypted = store.getState().encryptItem(item);
          await saveEncryptedItem(id, uint8ToBase64(encrypted));
        }

        return { id };
      }

      case 'UPDATE_ITEM': {
        store.getState().updateItem(message.id, message.updates);

        // Re-encrypt and persist
        const updated = store.getState().items.find((i) => i.id === message.id);
        if (updated) {
          const encrypted = store.getState().encryptItem(updated);
          await saveEncryptedItem(message.id, uint8ToBase64(encrypted));
        }

        return { ok: true };
      }

      case 'DELETE_ITEM': {
        store.getState().deleteItem(message.id);
        await deleteEncryptedItem(message.id);
        return { ok: true };
      }

      // -------------------------------------------------------------------
      // Password generation
      // -------------------------------------------------------------------
      case 'GENERATE_PASSWORD': {
        const options = message.options as PasswordGeneratorOptions;
        const password = generatePassword(options);
        const entropy = calculateEntropy(options);
        return { password, entropy };
      }

      // -------------------------------------------------------------------
      // Active tab
      // -------------------------------------------------------------------
      case 'GET_ACTIVE_TAB_URL': {
        const tabs = await browser.tabs.query({ active: true, currentWindow: true });
        const url = tabs[0]?.url ?? null;
        return { url };
      }

      // -------------------------------------------------------------------
      // Clipboard
      // -------------------------------------------------------------------
      case 'CLIPBOARD_COPIED': {
        // Could set a timer to clear clipboard; for now acknowledge
        return { ok: true };
      }

      // -------------------------------------------------------------------
      // Settings
      // -------------------------------------------------------------------
      case 'GET_SETTINGS': {
        const settings = await loadSettings();
        return { settings };
      }

      case 'UPDATE_SETTINGS': {
        await saveSettings(message.settings);

        // Reconfigure auto-lock if relevant settings changed
        if (
          autoLock &&
          ('autoLockMode' in message.settings || 'autoLockMinutes' in message.settings)
        ) {
          const settings = await loadSettings();
          autoLock.start(settings.autoLockMode, settings.autoLockMinutes);
        }

        return { ok: true };
      }

      // -------------------------------------------------------------------
      // PIN
      // -------------------------------------------------------------------
      case 'SET_PIN': {
        const dek = store.getState().getDEK();
        const { wrappedDek, salt } = await wrapDekWithPin(dek, message.pin);
        await savePinData({
          pinHash: uint8ToBase64(wrappedDek),
          salt: uint8ToBase64(salt),
          attemptsRemaining: 5,
        });
        return { ok: true };
      }

      case 'REMOVE_PIN': {
        await clearPinData();
        return { ok: true };
      }

      // -------------------------------------------------------------------
      // Sync
      // -------------------------------------------------------------------
      case 'GET_SYNC_STATUS': {
        const config = await loadSyncConfig();
        return {
          provider: config.provider,
          lastSynced: null,
          isSyncing: false,
        };
      }

      case 'CONFIGURE_SYNC': {
        await saveSyncConfig(message.config);
        return { ok: true };
      }

      case 'TRIGGER_SYNC': {
        // Sync not yet implemented
        return { ok: true };
      }

      case 'DISCONNECT_SYNC': {
        await clearSyncConfig();
        return { ok: true };
      }

      default: {
        return { error: `Unknown message type: ${(message as { type: string }).type}` };
      }
    }
  };
}
