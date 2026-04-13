/**
 * Sync handlers: status, configure, trigger, disconnect, restore, mismatch resolution.
 */

import browser from 'webextension-polyfill';
import { deserializeVaultHeader } from '@keykeykey/core';
import { fromBase64 } from '@keykeykey/core/utils';
import type { SyncConfig } from '@keykeykey/core/sync';
import { loadVaultHeader, loadEncryptedItems, clearSyncConfig } from '../storage.js';
import type { HandlerContext } from '../context.js';

// ---------------------------------------------------------------------------
// GET_SYNC_STATUS
// ---------------------------------------------------------------------------

export async function getSyncStatus(
  _msg: { type: 'GET_SYNC_STATUS' },
  ctx: HandlerContext,
): Promise<unknown> {
  return ctx.getSyncStatus();
}

// ---------------------------------------------------------------------------
// CONFIGURE_SYNC
// ---------------------------------------------------------------------------

export async function configureSync(
  msg: { type: 'CONFIGURE_SYNC'; config: SyncConfig },
  ctx: HandlerContext,
  sender?: unknown,
): Promise<unknown> {
  const senderTyped = sender as { tab?: { id?: number; url?: string } } | undefined;
  // Only allow from popup/background (not content scripts)
  if (senderTyped?.tab) return { error: 'Not allowed from content scripts' };
  if (ctx.store.getState().status !== 'unlocked') return { error: 'Vault is locked' };
  const lc = ctx.getLifecycle();
  if (!lc) return { error: 'Sync not initialized' };
  await lc.saveConfig(msg.config);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// TRIGGER_SYNC
// ---------------------------------------------------------------------------

export async function triggerSync(
  _msg: { type: 'TRIGGER_SYNC' },
  ctx: HandlerContext,
  sender?: unknown,
): Promise<unknown> {
  const senderTyped = sender as { tab?: { id?: number; url?: string } } | undefined;
  if (senderTyped?.tab) return { error: 'Not allowed from content scripts' };
  const lc = ctx.getLifecycle();
  if (!lc) return { ok: false, error: 'Sync not initialized' };
  const result = await lc.triggerSync();
  if (result.lastSynced) {
    ctx.setLastSynced(result.lastSynced);
    ctx.setSyncError(null);
  }
  if (result.error) {
    ctx.setSyncError(result.error);
  }
  return { ok: !result.error, lastSynced: result.lastSynced, error: result.error };
}

// ---------------------------------------------------------------------------
// DISCONNECT_SYNC
// ---------------------------------------------------------------------------

export async function disconnectSync(
  _msg: { type: 'DISCONNECT_SYNC' },
  ctx: HandlerContext,
  sender?: unknown,
): Promise<unknown> {
  const senderTyped = sender as { tab?: { id?: number; url?: string } } | undefined;
  if (senderTyped?.tab) return { error: 'Not allowed from content scripts' };
  const lc = ctx.getLifecycle();
  if (lc) {
    // saveConfig({ provider: 'none' }) persists the "none" state via SyncLifecycle
    await lc.saveConfig({ provider: 'none' });
  }
  ctx.teardownLifecycle();
  // Clear legacy unencrypted config (migration artifact)
  await clearSyncConfig();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// RESTORE_FROM_CLOUD
// ---------------------------------------------------------------------------

export async function restoreFromCloud(
  msg: { type: 'RESTORE_FROM_CLOUD'; config: SyncConfig; masterPassword: string },
  ctx: HandlerContext,
  sender?: unknown,
): Promise<unknown> {
  const senderTyped = sender as { tab?: { id?: number; url?: string } } | undefined;
  // Only allow from popup (not content scripts) and only during initial setup
  if (senderTyped?.tab) return { error: 'Not allowed from content scripts' };
  if (ctx.headerBase64) {
    return { success: false, error: 'Restore only allowed during initial setup' };
  }
  if (ctx.restoreState.status === 'restoring') {
    return { success: false, error: 'Restore already in progress' };
  }

  // Persist "restoring" BEFORE the long await so the popup can detect
  // an in-flight restore even if it closes immediately after sending.
  await ctx.setRestoreState({ status: 'restoring' });

  try {
    const lc = ctx.initLifecycle(ctx.syncableStore, () => ctx.store.getState().header ?? null);
    const result = await lc.restoreFromCloud(msg.config, msg.masterPassword);
    if (!result.success) {
      ctx.teardownLifecycle();
      await ctx.setRestoreState({
        status: 'error',
        error: result.error ?? 'Restore failed',
      });
      return result;
    }

    // Post-restore: load header into store, unlock, and start auto-lock
    // (mirrors the UNLOCK handler flow)
    const restoredHeaderB64 = await loadVaultHeader();
    if (restoredHeaderB64) {
      ctx.headerBase64 = restoredHeaderB64;
      const headerBytes = fromBase64(restoredHeaderB64);
      const header = deserializeVaultHeader(headerBytes);
      ctx.store.getState().loadHeader(header);

      const encItemMap = await loadEncryptedItems();
      const encryptedItems = Object.values(encItemMap).map(fromBase64);
      await ctx.store.getState().unlock(msg.masterPassword, encryptedItems);

      ctx.startAutoLock();

      // Re-create lifecycle with the now-unlocked store and init sync
      ctx.teardownLifecycle();
      const newLc = ctx.initLifecycle(ctx.syncableStore, () => ctx.store.getState().header ?? null);
      await newLc.initAfterUnlock();
    }

    await browser.storage.local.remove('last_connected_provider');
    await ctx.setRestoreState({ status: 'idle' });
    return result;
  } catch (err) {
    await ctx.setRestoreState({
      status: 'error',
      error: err instanceof Error ? err.message : 'Restore failed',
    });
    throw err;
  }
}

// ---------------------------------------------------------------------------
// CLEAR_RESTORE_STATUS
// ---------------------------------------------------------------------------

export async function clearRestoreStatus(
  _msg: { type: 'CLEAR_RESTORE_STATUS' },
  ctx: HandlerContext,
): Promise<unknown> {
  await ctx.setRestoreState({ status: 'idle' });
  return { ok: true };
}

// ---------------------------------------------------------------------------
// GET_MISMATCH_INFO
// ---------------------------------------------------------------------------

export async function getMismatchInfo(
  _msg: { type: 'GET_MISMATCH_INFO' },
  ctx: HandlerContext,
): Promise<unknown> {
  return ctx.getMismatchInfo();
}

// ---------------------------------------------------------------------------
// CLEAR_MISMATCH
// ---------------------------------------------------------------------------

export async function clearMismatch(
  _msg: { type: 'CLEAR_MISMATCH' },
  ctx: HandlerContext,
  sender?: unknown,
): Promise<unknown> {
  const senderTyped = sender as { tab?: { id?: number; url?: string } } | undefined;
  if (senderTyped?.tab) return { error: 'Not allowed from content scripts' };
  const lc = ctx.getLifecycle();
  if (!lc) return { error: 'Sync not initialized' };
  await lc.clearMismatch();
  ctx.setSyncError(null);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// REPLACE_REMOTE
// ---------------------------------------------------------------------------

export async function replaceRemote(
  _msg: { type: 'REPLACE_REMOTE' },
  ctx: HandlerContext,
  sender?: unknown,
): Promise<unknown> {
  const senderTyped = sender as { tab?: { id?: number; url?: string } } | undefined;
  if (senderTyped?.tab) return { error: 'Not allowed from content scripts' };
  const lc = ctx.getLifecycle();
  if (!lc) return { success: false, error: 'Sync not initialized' };
  // Persist progress state BEFORE starting so the popup can detect the
  // in-flight operation if it closes mid-run.
  await ctx.setSyncOpState({ status: 'replacing_remote' });
  try {
    const result = await lc.replaceRemote();
    if (result.success) {
      ctx.setSyncError(null);
      ctx.setLastSynced(new Date().toISOString());
      await ctx.setSyncOpState({ status: 'idle' });
    } else {
      await ctx.setSyncOpState({
        status: 'error',
        error: result.error ?? 'Replace remote failed',
      });
    }
    return result;
  } catch (e) {
    await ctx.setSyncOpState({
      status: 'error',
      error: e instanceof Error ? e.message : String(e),
    });
    throw e;
  }
}

// ---------------------------------------------------------------------------
// REPLACE_LOCAL
// ---------------------------------------------------------------------------

export async function replaceLocal(
  _msg: { type: 'REPLACE_LOCAL' },
  ctx: HandlerContext,
  sender?: unknown,
): Promise<unknown> {
  const senderTyped = sender as { tab?: { id?: number; url?: string } } | undefined;
  if (senderTyped?.tab) return { error: 'Not allowed from content scripts' };
  const lc = ctx.getLifecycle();
  if (!lc) return { success: false, error: 'Sync not initialized' };
  await ctx.setSyncOpState({ status: 'replacing_local' });
  try {
    const result = await lc.replaceLocal();
    if (result.success) {
      ctx.setSyncError(null);
      ctx.setLastSynced(new Date().toISOString());
      await ctx.setSyncOpState({ status: 'idle' });
    } else {
      await ctx.setSyncOpState({
        status: 'error',
        error: result.error ?? 'Replace local failed',
      });
    }
    return result;
  } catch (e) {
    await ctx.setSyncOpState({
      status: 'error',
      error: e instanceof Error ? e.message : String(e),
    });
    throw e;
  }
}

// ---------------------------------------------------------------------------
// MERGE_VAULTS
// ---------------------------------------------------------------------------

export async function mergeVaults(
  _msg: { type: 'MERGE_VAULTS' },
  ctx: HandlerContext,
  sender?: unknown,
): Promise<unknown> {
  const senderTyped = sender as { tab?: { id?: number; url?: string } } | undefined;
  if (senderTyped?.tab) return { error: 'Not allowed from content scripts' };
  const lc = ctx.getLifecycle();
  if (!lc) return { success: false, error: 'Sync not initialized' };
  await ctx.setSyncOpState({ status: 'merging' });
  try {
    const result = await lc.mergeVaults();
    if (result.success) {
      ctx.setSyncError(null);
      ctx.setLastSynced(new Date().toISOString());
      await ctx.setSyncOpState({ status: 'idle' });
    } else {
      await ctx.setSyncOpState({
        status: 'error',
        error: result.error ?? 'Merge failed',
      });
    }
    return result;
  } catch (e) {
    await ctx.setSyncOpState({
      status: 'error',
      error: e instanceof Error ? e.message : String(e),
    });
    throw e;
  }
}

// ---------------------------------------------------------------------------
// CLEAR_SYNC_OP_STATUS
// ---------------------------------------------------------------------------

export async function clearSyncOpStatus(
  _msg: { type: 'CLEAR_SYNC_OP_STATUS' },
  ctx: HandlerContext,
): Promise<unknown> {
  await ctx.setSyncOpState({ status: 'idle' });
  return { ok: true };
}

// ---------------------------------------------------------------------------
// CLEAR_SYNC_CONNECT_STATUS
// ---------------------------------------------------------------------------

export async function clearSyncConnectStatus(
  _msg: { type: 'CLEAR_SYNC_CONNECT_STATUS' },
  ctx: HandlerContext,
): Promise<unknown> {
  await ctx.setSyncConnectState({ status: 'idle' });
  return { ok: true };
}
