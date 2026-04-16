/**
 * Import/export handlers: import items with fire-and-forget pattern, status, clear.
 */

import { toBase64 } from '@keykeykey/core/utils';
import { saveEncryptedItem } from '../storage.js';
import type { HandlerContext } from '../context.js';
import type { NewItemData } from '../../lib/messages.js';
import { rejectIfExternal } from './sender-guard.js';

// ---------------------------------------------------------------------------
// IMPORT_ITEMS
// ---------------------------------------------------------------------------

export async function importItems(
  msg: { type: 'IMPORT_ITEMS'; items: NewItemData[] },
  ctx: HandlerContext,
  sender?: unknown,
): Promise<unknown> {
  const rejected = rejectIfExternal(sender);
  if (rejected) return rejected;
  if (ctx.store.getState().status !== 'unlocked') return { error: 'Vault is locked' };
  if (ctx.importState.status === 'importing' || ctx.importState.status === 'syncing') {
    return { error: 'Import already in progress' };
  }

  const importItemsList = msg.items;
  ctx.setImportState({ status: 'importing', imported: 0, total: importItemsList.length });

  // Fire and forget — work continues after response
  (async () => {
    try {
      // Add all items to store at once
      const ids = ctx.store.getState().addItems(importItemsList);

      // Encrypt and persist each item
      const state = ctx.store.getState();
      for (const id of ids) {
        const item = state.items.find((i) => i.id === id);
        if (item) {
          const encrypted = state.encryptItem(item);
          await saveEncryptedItem(id, toBase64(encrypted));
          ctx.setImportState({
            ...ctx.importState,
            imported: ctx.importState.imported + 1,
          });
        }
      }

      // Sync to cloud
      ctx.setImportState({ ...ctx.importState, status: 'syncing' });
      const lc = ctx.getLifecycle();
      if (lc) {
        const syncResult = await lc.triggerSync();
        if (syncResult.lastSynced) ctx.setLastSynced(syncResult.lastSynced);
        if (syncResult.error) ctx.setSyncError(syncResult.error);
      }

      ctx.setImportState({ ...ctx.importState, status: 'done' });
    } catch (err) {
      ctx.setImportState({
        status: 'error',
        imported: ctx.importState.imported,
        total: ctx.importState.total,
        error: err instanceof Error ? err.message : 'Import failed',
      });
    }
  })();

  return { ok: true };
}

// ---------------------------------------------------------------------------
// GET_IMPORT_STATUS
// ---------------------------------------------------------------------------

export async function getImportStatus(
  _msg: { type: 'GET_IMPORT_STATUS' },
  ctx: HandlerContext,
): Promise<unknown> {
  return { ...ctx.importState };
}

// ---------------------------------------------------------------------------
// CLEAR_IMPORT_STATUS
// ---------------------------------------------------------------------------

export async function clearImportStatus(
  _msg: { type: 'CLEAR_IMPORT_STATUS' },
  ctx: HandlerContext,
): Promise<unknown> {
  ctx.setImportState({ status: 'idle', imported: 0, total: 0 });
  return { ok: true };
}
