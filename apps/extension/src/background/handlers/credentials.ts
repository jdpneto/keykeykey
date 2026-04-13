/**
 * Credential autofill handlers: tab matching, fill, save, update, popup-fill.
 */

import browser from 'webextension-polyfill';
import { matchCredentialsByDomain } from '@keykeykey/core';
import type { VaultItem } from '@keykeykey/core';
import { toBase64 } from '@keykeykey/core/utils';
import { saveEncryptedItem } from '../storage.js';
import type { HandlerContext } from '../context.js';

// ---------------------------------------------------------------------------
// GET_CREDENTIALS_FOR_TAB
// ---------------------------------------------------------------------------

export async function getCredentialsForTab(
  msg: { type: 'GET_CREDENTIALS_FOR_TAB'; hostname: string },
  ctx: HandlerContext,
): Promise<unknown> {
  if (ctx.store.getState().status !== 'unlocked') return { count: 0 };
  const matches = matchCredentialsByDomain(msg.hostname, ctx.store.getState().items);
  return { count: matches.length };
}

// ---------------------------------------------------------------------------
// GET_MATCHING_CREDENTIALS
// ---------------------------------------------------------------------------

export async function getMatchingCredentials(
  msg: { type: 'GET_MATCHING_CREDENTIALS'; hostname: string },
  ctx: HandlerContext,
  sender?: unknown,
): Promise<unknown> {
  if (ctx.store.getState().status !== 'unlocked') return { error: 'Vault is locked' };
  const matches = matchCredentialsByDomain(msg.hostname, ctx.store.getState().items);
  const credentials = matches
    .filter((item): item is VaultItem & { type: 'credential' } => item.type === 'credential')
    .map((item) => ({ id: item.id, name: item.name, username: item.username }));

  // Populate allowlist for sender tab
  const senderTyped = sender as { tab?: { id?: number; url?: string } } | undefined;
  if (senderTyped?.tab?.id) {
    ctx.tabAllowlists.set(senderTyped.tab.id, new Set(matches.map((m) => m.id)));
  }

  return { credentials };
}

// ---------------------------------------------------------------------------
// FILL_CREDENTIAL
// ---------------------------------------------------------------------------

export async function fillCredential(
  msg: { type: 'FILL_CREDENTIAL'; id: string },
  ctx: HandlerContext,
  sender?: unknown,
): Promise<unknown> {
  if (ctx.store.getState().status !== 'unlocked') return { error: 'Vault is locked' };

  const senderTyped = sender as { tab?: { id?: number; url?: string } } | undefined;
  const senderTabId = senderTyped?.tab?.id;
  if (!senderTabId) return { error: 'No sender tab' };

  // Check allowlist
  const allowed = ctx.tabAllowlists.get(senderTabId);
  if (!allowed || !allowed.has(msg.id)) {
    return { error: 'Credential not in allowlist for this tab' };
  }

  // Find the credential
  const credential = ctx.store.getState().items.find((i) => i.id === msg.id);
  if (!credential || credential.type !== 'credential') {
    return { error: 'Credential not found' };
  }

  // Validate domain match between sender tab URL and credential URL
  if (!senderTyped?.tab?.url || !credential.url) {
    return { error: 'Cannot verify domain match — credential or sender URL missing' };
  }
  let senderHostname: string;
  try {
    senderHostname = new URL(senderTyped.tab.url).hostname;
  } catch {
    return { error: 'Invalid sender tab URL' };
  }
  const domainMatch = matchCredentialsByDomain(senderHostname, [credential]);
  if (domainMatch.length === 0) {
    return { error: 'Domain mismatch' };
  }

  return { username: credential.username, password: credential.password };
}

// ---------------------------------------------------------------------------
// CHECK_CREDENTIAL_EXISTS
// ---------------------------------------------------------------------------

export async function checkCredentialExists(
  msg: { type: 'CHECK_CREDENTIAL_EXISTS'; hostname: string; username: string; password: string },
  ctx: HandlerContext,
): Promise<unknown> {
  if (ctx.store.getState().status !== 'unlocked') return { error: 'Vault is locked' };
  const domainMatches = matchCredentialsByDomain(msg.hostname, ctx.store.getState().items);
  const existing = domainMatches.find(
    (item) => item.type === 'credential' && item.username === msg.username,
  );
  if (!existing || existing.type !== 'credential') {
    return { exists: false, changed: false };
  }
  const changed = existing.password !== msg.password;
  return { exists: true, changed, credentialId: existing.id };
}

// ---------------------------------------------------------------------------
// SAVE_CREDENTIAL
// ---------------------------------------------------------------------------

export async function saveCredential(
  msg: { type: 'SAVE_CREDENTIAL'; url: string; username: string; password: string; name: string },
  ctx: HandlerContext,
  sender?: unknown,
): Promise<unknown> {
  const senderTyped = sender as { tab?: { id?: number; url?: string } } | undefined;
  if (!senderTyped?.tab?.id) return { error: 'No sender tab' };
  if (ctx.store.getState().status !== 'unlocked') return { error: 'Vault is locked' };
  const newId = ctx.store.getState().addItem({
    type: 'credential',
    name: msg.name,
    url: msg.url,
    username: msg.username,
    password: msg.password,
    notes: '',
    tags: [],
    favorite: false,
  });

  // Encrypt and persist (same pattern as ADD_ITEM)
  const newItem = ctx.store.getState().items.find((i) => i.id === newId);
  if (newItem) {
    const encryptedNew = ctx.store.getState().encryptItem(newItem);
    await saveEncryptedItem(newId, toBase64(encryptedNew));
  }

  return { success: true };
}

// ---------------------------------------------------------------------------
// UPDATE_CREDENTIAL
// ---------------------------------------------------------------------------

export async function updateCredential(
  msg: { type: 'UPDATE_CREDENTIAL'; credentialId: string; password: string },
  ctx: HandlerContext,
  sender?: unknown,
): Promise<unknown> {
  const senderTyped = sender as { tab?: { id?: number; url?: string } } | undefined;
  if (!senderTyped?.tab?.id || !senderTyped?.tab?.url) return { error: 'No sender tab' };
  if (ctx.store.getState().status !== 'unlocked') return { error: 'Vault is locked' };

  // Verify domain match between sender and credential being updated
  const existing = ctx.store.getState().items.find((i) => i.id === msg.credentialId);
  if (!existing || existing.type !== 'credential') return { error: 'Credential not found' };
  if (existing.url) {
    const matches = matchCredentialsByDomain(new URL(senderTyped.tab.url).hostname, [existing]);
    if (matches.length === 0) return { error: 'Domain mismatch' };
  }

  ctx.store.getState().updateItem(msg.credentialId, { password: msg.password });

  // Re-encrypt and persist (same pattern as UPDATE_ITEM)
  const updatedCred = ctx.store.getState().items.find((i) => i.id === msg.credentialId);
  if (updatedCred) {
    const encryptedUpd = ctx.store.getState().encryptItem(updatedCred);
    await saveEncryptedItem(msg.credentialId, toBase64(encryptedUpd));
  }

  return { success: true };
}

// ---------------------------------------------------------------------------
// FILL_ACTIVE_TAB
// ---------------------------------------------------------------------------

export async function fillActiveTab(
  msg: { type: 'FILL_ACTIVE_TAB'; username: string; password: string },
  ctx: HandlerContext,
  sender?: unknown,
): Promise<unknown> {
  const senderTyped = sender as { tab?: { id?: number; url?: string } } | undefined;
  if (senderTyped?.tab) return { error: 'Not allowed from content scripts' };
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  const tabId = tabs[0]?.id;
  if (!tabId) return { error: 'No active tab' };
  try {
    await browser.tabs.sendMessage(tabId, {
      type: 'FILL_FROM_POPUP',
      username: msg.username,
      password: msg.password,
    });
    return { ok: true };
  } catch {
    return { error: 'Could not reach content script on this page' };
  }
}
