/**
 * Vault lifecycle handlers: status, setup, unlock (password + PIN), lock, validate, reset.
 */

import browser from 'webextension-polyfill';
import {
  generateRecoveryKey,
  createVaultHeader,
  serializeVaultHeader,
  deserializeVaultHeader,
  ARGON2_PRESETS,
} from '@keykeykey/core';
import { unlockVault } from '@keykeykey/core/crypto';
import { toBase64, fromBase64 } from '@keykeykey/core/utils';
import { unwrapDekWithPin } from '@keykeykey/core/pin';
import {
  saveVaultHeader,
  loadEncryptedItems,
  deleteEncryptedItem,
  loadPinData,
  clearPinData,
  clearSyncConfig,
  clearSyncConfigEncrypted,
} from '../storage.js';
import type { HandlerContext } from '../context.js';

// ---------------------------------------------------------------------------
// GET_STATUS
// ---------------------------------------------------------------------------

export async function getStatus(
  _msg: { type: 'GET_STATUS' },
  ctx: HandlerContext,
): Promise<unknown> {
  const state = ctx.store.getState();
  const status = !ctx.headerBase64
    ? 'needs_setup'
    : state.status === 'unlocked'
      ? 'unlocked'
      : 'locked';
  const hasPIN = (await loadPinData()) !== null;
  return { status, hasPIN, itemCount: state.items.length };
}

// ---------------------------------------------------------------------------
// SETUP
// ---------------------------------------------------------------------------

export async function setup(
  msg: { type: 'SETUP'; password: string },
  ctx: HandlerContext,
): Promise<unknown> {
  const { raw, formatted } = generateRecoveryKey();
  const { header } = await createVaultHeader(msg.password, raw, ARGON2_PRESETS.browser);

  // Serialize and persist
  const serialized = serializeVaultHeader(header);
  const b64 = toBase64(serialized);
  await saveVaultHeader(b64);
  ctx.headerBase64 = b64;

  // Load header into store and unlock (no items yet)
  ctx.store.getState().loadHeader(header);
  await ctx.store.getState().unlock(msg.password, []);

  // Start auto-lock
  ctx.startAutoLock();

  // Initialize sync lifecycle (needed for CONFIGURE_SYNC)
  const lc = ctx.initLifecycle(ctx.syncableStore, () => ctx.store.getState().header ?? null);
  await lc.initAfterUnlock();

  await browser.storage.local.remove('last_connected_provider');
  return { recoveryKey: formatted };
}

// ---------------------------------------------------------------------------
// UNLOCK
// ---------------------------------------------------------------------------

export async function unlock(
  msg: { type: 'UNLOCK'; password: string },
  ctx: HandlerContext,
): Promise<unknown> {
  if (!ctx.headerBase64) {
    return { error: 'No vault found. Please set up first.' };
  }

  try {
    const headerBytes = fromBase64(ctx.headerBase64);
    const header = deserializeVaultHeader(headerBytes);
    ctx.store.getState().loadHeader(header);

    // Load encrypted items from storage
    const encItemMap = await loadEncryptedItems();
    const encryptedItems = Object.values(encItemMap).map(fromBase64);

    await ctx.store.getState().unlock(msg.password, encryptedItems);
    ctx.startAutoLock();

    // Initialize sync after unlock
    const lc = ctx.initLifecycle(ctx.syncableStore, () => ctx.store.getState().header ?? null);
    await lc.initAfterUnlock();

    return { ok: true };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : 'Unlock failed';
    if (errMsg === 'invalid tag') {
      return { error: 'Incorrect master password.' };
    }
    return { error: errMsg };
  }
}

// ---------------------------------------------------------------------------
// UNLOCK_PIN
// ---------------------------------------------------------------------------

export async function unlockPin(
  msg: { type: 'UNLOCK_PIN'; pin: string },
  ctx: HandlerContext,
): Promise<unknown> {
  const pinData = await loadPinData();
  if (!pinData) {
    return { error: 'No PIN configured' };
  }

  try {
    const pinDataCore = {
      wrappedDEK: fromBase64(pinData.pinHash),
      salt: fromBase64(pinData.salt),
    };
    const dek = await unwrapDekWithPin(msg.pin, pinDataCore);
    if (!dek) throw new Error('Wrong PIN');

    // Load header and encrypted items
    if (!ctx.headerBase64) {
      return { error: 'No vault found' };
    }
    const headerBytes = fromBase64(ctx.headerBase64);
    const header = deserializeVaultHeader(headerBytes);
    ctx.store.getState().loadHeader(header);

    const encItemMap = await loadEncryptedItems();
    const encryptedItems = Object.values(encItemMap).map(fromBase64);

    // Unlock store with recovered DEK
    ctx.store.getState().unlockWithDEK(dek, encryptedItems);

    ctx.startAutoLock();

    // Initialize sync after PIN unlock
    const lc = ctx.initLifecycle(ctx.syncableStore, () => ctx.store.getState().header ?? null);
    await lc.initAfterUnlock();

    return { success: true };
  } catch {
    const remaining = pinData.attemptsRemaining - 1;
    const { updatePinAttempts } = await import('../storage.js');
    await updatePinAttempts(remaining);
    if (remaining <= 0) {
      return { error: 'PIN locked out. Use master password.' };
    }
    return { error: `Wrong PIN. ${remaining} attempts remaining.` };
  }
}

// ---------------------------------------------------------------------------
// LOCK
// ---------------------------------------------------------------------------

export async function lock(_msg: { type: 'LOCK' }, ctx: HandlerContext): Promise<unknown> {
  ctx.teardownLifecycle();
  ctx.store.getState().lock();
  ctx.autoLock?.stop();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// VALIDATE_MASTER_PASSWORD
// ---------------------------------------------------------------------------

export async function validateMasterPassword(
  msg: { type: 'VALIDATE_MASTER_PASSWORD'; password: string },
  ctx: HandlerContext,
  sender?: unknown,
): Promise<unknown> {
  const senderTyped = sender as { tab?: { id?: number; url?: string } } | undefined;
  if (senderTyped?.tab) return { error: 'Not allowed from content scripts' };
  if (ctx.store.getState().status !== 'unlocked') return { valid: false, error: 'Vault is locked' };
  // Validate directly against vault header — no lifecycle needed
  if (!ctx.headerBase64) return { valid: false, error: 'No vault found' };
  try {
    const headerBytes = fromBase64(ctx.headerBase64);
    const header = deserializeVaultHeader(headerBytes);
    const dek = await unlockVault(header, msg.password);
    dek.fill(0); // Zero key material immediately
    return { valid: true };
  } catch {
    return { valid: false };
  }
}

// ---------------------------------------------------------------------------
// RESET_VAULT
// ---------------------------------------------------------------------------

export async function resetVault(
  _msg: { type: 'RESET_VAULT' },
  ctx: HandlerContext,
  sender?: unknown,
): Promise<unknown> {
  const senderTyped = sender as { tab?: { id?: number; url?: string } } | undefined;
  // Only allow from popup/background (not content scripts or other extensions)
  if (senderTyped?.tab) return { error: 'Reset not allowed from content scripts' };
  // Tear down sync engine before clearing data
  ctx.teardownLifecycle();
  // Core store reset (zeros DEK, clears items, sets header to null)
  ctx.store.getState().resetVault();
  // Clear headerBase64 so GET_STATUS returns 'needs_setup'
  ctx.headerBase64 = null;
  // Stop auto-lock since vault is being destroyed
  ctx.autoLock?.stop();
  ctx.autoLock = null;
  // Clear all persisted data
  const allItems = await loadEncryptedItems();
  for (const id of Object.keys(allItems)) {
    await deleteEncryptedItem(id);
  }
  await saveVaultHeader('');
  await clearPinData();
  await clearSyncConfig();
  await clearSyncConfigEncrypted();
  await browser.storage.local.remove('last_connected_provider');
  return { ok: true };
}
