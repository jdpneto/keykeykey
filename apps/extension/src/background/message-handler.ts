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
  matchCredentialsByDomain,
} from '@keykeykey/core';
import { unlockVault } from '@keykeykey/core/crypto';
import type { PasswordGeneratorOptions, VaultItem } from '@keykeykey/core';
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
  clearSyncConfig,
  clearSyncConfigEncrypted,
} from './storage.js';
import { AutoLockManager } from './auto-lock.js';
import { setupPin, unwrapDekWithPin } from '@keykeykey/core/pin';
import { toBase64, fromBase64 } from '@keykeykey/core/utils';
import { scheduleClipboardClear } from './clipboard.js';
import {
  initLifecycle,
  getLifecycle,
  teardownLifecycle,
  getSyncStatus,
  getMismatchInfo,
  setLastSynced,
  setSyncError,
  recordTombstone,
} from './sync.js';
import type { SyncCompatibleStore } from './sync.js';

// ---------------------------------------------------------------------------
// Per-tab fillable credential allowlist
// ---------------------------------------------------------------------------

export const tabAllowlists = new Map<number, Set<string>>();

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createMessageHandler() {
  const store = createVaultStore();
  let autoLock: AutoLockManager | null = null;
  let headerBase64: string | null = null;

  // Sync-compatible store adapter
  const syncableStore: SyncCompatibleStore = {
    getState: () => store.getState(),
    setState: (partial) => store.setState(partial),
    getVaultId: () => store.getState().header?.vaultId ?? '',
    subscribe: (listener) => store.subscribe(listener),
  };

  // Load initial state from storage
  let initPromise: Promise<void> | null = loadInitialState();

  async function loadInitialState(): Promise<void> {
    headerBase64 = await loadVaultHeader();

    // Migrate v1 headers to v2 (assigns stable vaultId)
    if (headerBase64) {
      const headerBytes = fromBase64(headerBase64);
      const header = deserializeVaultHeader(headerBytes);
      if (header.version === 1) {
        header.version = 2;
        const v2Bytes = serializeVaultHeader(header);
        headerBase64 = toBase64(v2Bytes);
        await saveVaultHeader(headerBase64);
      }
    }
  }

  function startAutoLock(): void {
    if (autoLock) {
      autoLock.stop();
    }
    autoLock = new AutoLockManager(() => {
      teardownLifecycle();
      store.getState().lock();
    });
    // Load settings to configure auto-lock
    loadSettings().then((settings) => {
      autoLock?.start(settings.autoLockMode, settings.autoLockMinutes);
    });
  }

  return async function handleMessage(
    message: BackgroundMessage,
    sender?: browser.Runtime.MessageSender,
  ): Promise<unknown> {
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
        const { header } = await createVaultHeader(message.password, raw, ARGON2_PRESETS.browser);

        // Serialize and persist
        const serialized = serializeVaultHeader(header);
        const b64 = toBase64(serialized);
        await saveVaultHeader(b64);
        headerBase64 = b64;

        // Load header into store and unlock (no items yet)
        store.getState().loadHeader(header);
        await store.getState().unlock(message.password, []);

        // Start auto-lock
        startAutoLock();

        // Initialize sync lifecycle (needed for CONFIGURE_SYNC)
        const lc = initLifecycle(syncableStore, () => store.getState().header ?? null);
        await lc.initAfterUnlock();

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
          const headerBytes = fromBase64(headerBase64);
          const header = deserializeVaultHeader(headerBytes);
          store.getState().loadHeader(header);

          // Load encrypted items from storage
          const encItemMap = await loadEncryptedItems();
          const encryptedItems = Object.values(encItemMap).map(fromBase64);

          await store.getState().unlock(message.password, encryptedItems);
          startAutoLock();

          // Initialize sync after unlock
          const lc = initLifecycle(syncableStore, () => store.getState().header ?? null);
          await lc.initAfterUnlock();

          return { ok: true };
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Unlock failed';
          if (msg === 'invalid tag') {
            return { error: 'Incorrect master password.' };
          }
          return { error: msg };
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
          const pinDataCore = {
            wrappedDEK: fromBase64(pinData.pinHash),
            salt: fromBase64(pinData.salt),
          };
          const dek = await unwrapDekWithPin(message.pin, pinDataCore);
          if (!dek) throw new Error('Wrong PIN');

          // Load header and encrypted items
          if (!headerBase64) {
            return { error: 'No vault found' };
          }
          const headerBytes = fromBase64(headerBase64);
          const header = deserializeVaultHeader(headerBytes);
          store.getState().loadHeader(header);

          const encItemMap = await loadEncryptedItems();
          const encryptedItems = Object.values(encItemMap).map(fromBase64);

          // Unlock store with recovered DEK
          store.getState().unlockWithDEK(dek, encryptedItems);

          startAutoLock();

          // Initialize sync after PIN unlock
          const lc = initLifecycle(syncableStore, () => store.getState().header ?? null);
          await lc.initAfterUnlock();

          return { success: true };
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
        teardownLifecycle();
        store.getState().lock();
        autoLock?.stop();
        return { ok: true };
      }

      // -------------------------------------------------------------------
      // Items
      // -------------------------------------------------------------------
      case 'GET_ITEMS': {
        if (store.getState().status !== 'unlocked') return { error: 'Vault is locked' };
        return { items: store.getState().items };
      }

      case 'SEARCH': {
        if (store.getState().status !== 'unlocked') return { error: 'Vault is locked' };
        const items = store.getState().search(message.query);
        return { items };
      }

      case 'ADD_ITEM': {
        if (store.getState().status !== 'unlocked') return { error: 'Vault is locked' };
        const id = store.getState().addItem(message.item);

        // Encrypt and persist
        const item = store.getState().items.find((i) => i.id === id);
        if (item) {
          const encrypted = store.getState().encryptItem(item);
          await saveEncryptedItem(id, toBase64(encrypted));
        }

        return { id };
      }

      case 'UPDATE_ITEM': {
        if (store.getState().status !== 'unlocked') return { error: 'Vault is locked' };
        store.getState().updateItem(message.id, message.updates);

        // Re-encrypt and persist
        const updated = store.getState().items.find((i) => i.id === message.id);
        if (updated) {
          const encrypted = store.getState().encryptItem(updated);
          await saveEncryptedItem(message.id, toBase64(encrypted));
        }

        return { ok: true };
      }

      case 'DELETE_ITEM': {
        if (store.getState().status !== 'unlocked') return { error: 'Vault is locked' };
        store.getState().deleteItem(message.id);
        await deleteEncryptedItem(message.id);
        recordTombstone(message.id);
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
        scheduleClipboardClear();
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
        if (store.getState().status !== 'unlocked') {
          return { error: 'Vault must be unlocked to set PIN' };
        }
        const dek = store.getState().getDEK();
        const { wrappedDEK, salt } = await setupPin(message.pin, dek);
        await savePinData({
          pinHash: toBase64(wrappedDEK),
          salt: toBase64(salt),
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
        return getSyncStatus();
      }

      case 'CONFIGURE_SYNC': {
        // Only allow from popup/background (not content scripts)
        if (sender?.tab) return { error: 'Not allowed from content scripts' };
        if (store.getState().status !== 'unlocked') return { error: 'Vault is locked' };
        const lc = getLifecycle();
        if (!lc) return { error: 'Sync not initialized' };
        await lc.saveConfig(message.config);
        return { ok: true };
      }

      case 'TRIGGER_SYNC': {
        if (sender?.tab) return { error: 'Not allowed from content scripts' };
        const lc = getLifecycle();
        if (!lc) return { ok: false, error: 'Sync not initialized' };
        const result = await lc.triggerSync();
        if (result.lastSynced) {
          setLastSynced(result.lastSynced);
          setSyncError(null);
        }
        if (result.error) {
          setSyncError(result.error);
        }
        return { ok: !result.error, lastSynced: result.lastSynced, error: result.error };
      }

      case 'DISCONNECT_SYNC': {
        if (sender?.tab) return { error: 'Not allowed from content scripts' };
        const lc = getLifecycle();
        if (lc) {
          // saveConfig({ provider: 'none' }) persists the "none" state via SyncLifecycle
          await lc.saveConfig({ provider: 'none' });
        }
        teardownLifecycle();
        // Clear legacy unencrypted config (migration artifact)
        await clearSyncConfig();
        return { ok: true };
      }

      case 'VALIDATE_MASTER_PASSWORD': {
        if (sender?.tab) return { error: 'Not allowed from content scripts' };
        if (store.getState().status !== 'unlocked')
          return { valid: false, error: 'Vault is locked' };
        // Validate directly against vault header — no lifecycle needed
        if (!headerBase64) return { valid: false, error: 'No vault found' };
        try {
          const headerBytes = fromBase64(headerBase64);
          const header = deserializeVaultHeader(headerBytes);
          const dek = await unlockVault(header, message.password);
          dek.fill(0); // Zero key material immediately
          return { valid: true };
        } catch {
          return { valid: false };
        }
      }

      case 'RESTORE_FROM_CLOUD': {
        // Only allow from popup (not content scripts) and only during initial setup
        if (sender?.tab) return { error: 'Not allowed from content scripts' };
        if (headerBase64) {
          return { success: false, error: 'Restore only allowed during initial setup' };
        }
        const lc = initLifecycle(syncableStore, () => store.getState().header ?? null);
        const result = await lc.restoreFromCloud(message.config, message.masterPassword);
        if (!result.success) {
          teardownLifecycle();
          return result;
        }

        // Post-restore: load header into store, unlock, and start auto-lock
        // (mirrors the UNLOCK handler flow)
        const restoredHeaderB64 = await loadVaultHeader();
        if (restoredHeaderB64) {
          headerBase64 = restoredHeaderB64;
          const headerBytes = fromBase64(restoredHeaderB64);
          const header = deserializeVaultHeader(headerBytes);
          store.getState().loadHeader(header);

          const encItemMap = await loadEncryptedItems();
          const encryptedItems = Object.values(encItemMap).map(fromBase64);
          await store.getState().unlock(message.masterPassword, encryptedItems);

          startAutoLock();

          // Re-create lifecycle with the now-unlocked store and init sync
          teardownLifecycle();
          const newLc = initLifecycle(syncableStore, () => store.getState().header ?? null);
          await newLc.initAfterUnlock();
        }

        return result;
      }

      case 'GET_MISMATCH_INFO': {
        return getMismatchInfo();
      }

      case 'CLEAR_MISMATCH': {
        if (sender?.tab) return { error: 'Not allowed from content scripts' };
        const lc = getLifecycle();
        if (!lc) return { error: 'Sync not initialized' };
        await lc.clearMismatch();
        return { ok: true };
      }

      case 'REPLACE_REMOTE': {
        if (sender?.tab) return { error: 'Not allowed from content scripts' };
        const lc = getLifecycle();
        if (!lc) return { success: false, error: 'Sync not initialized' };
        return await lc.replaceRemote();
      }

      case 'REPLACE_LOCAL': {
        if (sender?.tab) return { error: 'Not allowed from content scripts' };
        const lc = getLifecycle();
        if (!lc) return { success: false, error: 'Sync not initialized' };
        return await lc.replaceLocal();
      }

      case 'MERGE_VAULTS': {
        if (sender?.tab) return { error: 'Not allowed from content scripts' };
        const lc = getLifecycle();
        if (!lc) return { success: false, error: 'Sync not initialized' };
        return await lc.mergeVaults();
      }

      // -------------------------------------------------------------------
      // Autofill: content script messages
      // -------------------------------------------------------------------
      case 'GET_CREDENTIALS_FOR_TAB': {
        if (store.getState().status !== 'unlocked') return { count: 0 };
        const matches = matchCredentialsByDomain(message.hostname, store.getState().items);
        return { count: matches.length };
      }

      case 'GET_MATCHING_CREDENTIALS': {
        if (store.getState().status !== 'unlocked') return { error: 'Vault is locked' };
        const matches = matchCredentialsByDomain(message.hostname, store.getState().items);
        const credentials = matches
          .filter((item): item is VaultItem & { type: 'credential' } => item.type === 'credential')
          .map((item) => ({ id: item.id, name: item.name, username: item.username }));

        // Populate allowlist for sender tab
        if (sender?.tab?.id) {
          tabAllowlists.set(sender.tab.id, new Set(matches.map((m) => m.id)));
        }

        return { credentials };
      }

      case 'FILL_CREDENTIAL': {
        if (store.getState().status !== 'unlocked') return { error: 'Vault is locked' };

        const senderTabId = sender?.tab?.id;
        if (!senderTabId) return { error: 'No sender tab' };

        // Check allowlist
        const allowed = tabAllowlists.get(senderTabId);
        if (!allowed || !allowed.has(message.id)) {
          return { error: 'Credential not in allowlist for this tab' };
        }

        // Find the credential
        const credential = store.getState().items.find((i) => i.id === message.id);
        if (!credential || credential.type !== 'credential') {
          return { error: 'Credential not found' };
        }

        // Validate domain match between sender tab URL and credential URL
        if (!sender?.tab?.url || !credential.url) {
          return { error: 'Cannot verify domain match — credential or sender URL missing' };
        }
        let senderHostname: string;
        try {
          senderHostname = new URL(sender.tab.url).hostname;
        } catch {
          return { error: 'Invalid sender tab URL' };
        }
        const domainMatch = matchCredentialsByDomain(senderHostname, [credential]);
        if (domainMatch.length === 0) {
          return { error: 'Domain mismatch' };
        }

        return { username: credential.username, password: credential.password };
      }

      case 'CHECK_CREDENTIAL_EXISTS': {
        if (store.getState().status !== 'unlocked') return { error: 'Vault is locked' };
        const domainMatches = matchCredentialsByDomain(message.hostname, store.getState().items);
        const existing = domainMatches.find(
          (item) => item.type === 'credential' && item.username === message.username,
        );
        if (!existing || existing.type !== 'credential') {
          return { exists: false, changed: false };
        }
        const changed = existing.password !== message.password;
        return { exists: true, changed, credentialId: existing.id };
      }

      case 'SAVE_CREDENTIAL': {
        if (!sender?.tab?.id) return { error: 'No sender tab' };
        if (store.getState().status !== 'unlocked') return { error: 'Vault is locked' };
        const newId = store.getState().addItem({
          type: 'credential',
          name: message.name,
          url: message.url,
          username: message.username,
          password: message.password,
          notes: '',
          tags: [],
          favorite: false,
        });

        // Encrypt and persist (same pattern as ADD_ITEM)
        const newItem = store.getState().items.find((i) => i.id === newId);
        if (newItem) {
          const encryptedNew = store.getState().encryptItem(newItem);
          await saveEncryptedItem(newId, toBase64(encryptedNew));
        }

        return { success: true };
      }

      // -------------------------------------------------------------------
      // Reset vault
      // -------------------------------------------------------------------
      case 'RESET_VAULT': {
        // Only allow from popup/background (not content scripts or other extensions)
        if (sender?.tab) return { error: 'Reset not allowed from content scripts' };
        // Tear down sync engine before clearing data
        teardownLifecycle();
        // Core store reset (zeros DEK, clears items, sets header to null)
        store.getState().resetVault();
        // Clear headerBase64 closure so GET_STATUS returns 'needs_setup'
        headerBase64 = null;
        // Stop auto-lock since vault is being destroyed
        autoLock?.stop();
        autoLock = null;
        // Clear all persisted data
        const allItems = await loadEncryptedItems();
        for (const id of Object.keys(allItems)) {
          await deleteEncryptedItem(id);
        }
        await saveVaultHeader('');
        await clearPinData();
        await clearSyncConfig();
        await clearSyncConfigEncrypted();
        return { ok: true };
      }

      case 'UPDATE_CREDENTIAL': {
        if (!sender?.tab?.id || !sender?.tab?.url) return { error: 'No sender tab' };
        if (store.getState().status !== 'unlocked') return { error: 'Vault is locked' };

        // Verify domain match between sender and credential being updated
        const existing = store.getState().items.find((i) => i.id === message.credentialId);
        if (!existing || existing.type !== 'credential') return { error: 'Credential not found' };
        if (existing.url) {
          const matches = matchCredentialsByDomain(new URL(sender.tab.url).hostname, [existing]);
          if (matches.length === 0) return { error: 'Domain mismatch' };
        }

        store.getState().updateItem(message.credentialId, { password: message.password });

        // Re-encrypt and persist (same pattern as UPDATE_ITEM)
        const updatedCred = store.getState().items.find((i) => i.id === message.credentialId);
        if (updatedCred) {
          const encryptedUpd = store.getState().encryptItem(updatedCred);
          await saveEncryptedItem(message.credentialId, toBase64(encryptedUpd));
        }

        return { success: true };
      }

      default: {
        return { error: `Unknown message type: ${(message as { type: string }).type}` };
      }
    }
  };
}
