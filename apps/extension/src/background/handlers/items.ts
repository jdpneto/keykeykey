/**
 * Item CRUD handlers: get, search, add, update, delete.
 */

import { matchCredentialsByDomain } from '@keykeykey/core';
import { toBase64 } from '@keykeykey/core/utils';
import { saveEncryptedItem, deleteEncryptedItem } from '../storage.js';
import type { HandlerContext } from '../context.js';
import type { NewItemData, ItemUpdates } from '../../lib/messages.js';

// ---------------------------------------------------------------------------
// GET_ITEMS
// ---------------------------------------------------------------------------

export async function getItems(_msg: { type: 'GET_ITEMS' }, ctx: HandlerContext): Promise<unknown> {
  if (ctx.store.getState().status !== 'unlocked') return { error: 'Vault is locked' };
  return { items: ctx.store.getState().items };
}

// ---------------------------------------------------------------------------
// GET_ITEMS_FOR_HOST
// ---------------------------------------------------------------------------

export async function getItemsForHost(
  msg: { type: 'GET_ITEMS_FOR_HOST'; hostname: string },
  ctx: HandlerContext,
): Promise<unknown> {
  if (ctx.store.getState().status !== 'unlocked') return { error: 'Vault is locked' };
  const all = ctx.store.getState().items;
  const matches = matchCredentialsByDomain(msg.hostname, all);
  const matchIds = matches.map((m) => m.id);
  return { items: all, matchedIds: matchIds };
}

// ---------------------------------------------------------------------------
// SEARCH
// ---------------------------------------------------------------------------

export async function search(
  msg: {
    type: 'SEARCH';
    query: string;
    types?: ('credential' | 'card' | 'secure-note')[];
    deepFields?: boolean;
  },
  ctx: HandlerContext,
): Promise<unknown> {
  if (ctx.store.getState().status !== 'unlocked') return { error: 'Vault is locked' };
  const items = ctx.store
    .getState()
    .search(msg.query, { types: msg.types, deepFields: msg.deepFields });
  return { items };
}

// ---------------------------------------------------------------------------
// ADD_ITEM
// ---------------------------------------------------------------------------

export async function addItem(
  msg: { type: 'ADD_ITEM'; item: NewItemData },
  ctx: HandlerContext,
): Promise<unknown> {
  if (ctx.store.getState().status !== 'unlocked') return { error: 'Vault is locked' };
  const id = ctx.store.getState().addItem(msg.item);

  // Encrypt and persist
  const item = ctx.store.getState().items.find((i) => i.id === id);
  if (item) {
    const encrypted = ctx.store.getState().encryptItem(item);
    await saveEncryptedItem(id, toBase64(encrypted));
  }

  return { id };
}

// ---------------------------------------------------------------------------
// UPDATE_ITEM
// ---------------------------------------------------------------------------

export async function updateItem(
  msg: { type: 'UPDATE_ITEM'; id: string; updates: ItemUpdates },
  ctx: HandlerContext,
): Promise<unknown> {
  if (ctx.store.getState().status !== 'unlocked') return { error: 'Vault is locked' };
  ctx.store.getState().updateItem(msg.id, msg.updates);

  // Re-encrypt and persist
  const updated = ctx.store.getState().items.find((i) => i.id === msg.id);
  if (updated) {
    const encrypted = ctx.store.getState().encryptItem(updated);
    await saveEncryptedItem(msg.id, toBase64(encrypted));
  }

  return { ok: true };
}

// ---------------------------------------------------------------------------
// DELETE_ITEM
// ---------------------------------------------------------------------------

export async function deleteItem(
  msg: { type: 'DELETE_ITEM'; id: string },
  ctx: HandlerContext,
): Promise<unknown> {
  if (ctx.store.getState().status !== 'unlocked') return { error: 'Vault is locked' };
  ctx.store.getState().deleteItem(msg.id);
  await deleteEncryptedItem(msg.id);
  ctx.recordTombstone(msg.id);
  return { ok: true };
}
