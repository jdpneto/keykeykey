/**
 * Credential autofill handlers: tab matching, fill, save, update, popup-fill.
 */

import browser from 'webextension-polyfill';
import { matchCredentialsByDomain } from '@keykeykey/core';
import type { VaultItem } from '@keykeykey/core';
import { toBase64 } from '@keykeykey/core/utils';
import { generateTotpCode, parseTotpUri } from '@keykeykey/core/totp';
import { saveEncryptedItem } from '../storage.js';
import type { HandlerContext } from '../context.js';
import { rejectIfExternal } from './sender-guard.js';

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
// GET_MATCHING_TOTP_CREDENTIALS — TOTP-only variant of GET_MATCHING_CREDENTIALS.
// Returns credentials that have a `totp` field and match the page's hostname,
// and (like its sibling) populates the per-tab allowlist so the matching
// FILL_TOTP_CODE call can later be authorized.
// ---------------------------------------------------------------------------

export async function getMatchingTotpCredentials(
  msg: { type: 'GET_MATCHING_TOTP_CREDENTIALS'; hostname: string },
  ctx: HandlerContext,
  sender?: unknown,
): Promise<unknown> {
  if (ctx.store.getState().status !== 'unlocked') return { error: 'Vault is locked' };
  const matches = matchCredentialsByDomain(msg.hostname, ctx.store.getState().items).filter(
    (item): item is VaultItem & { type: 'credential'; totp: string } =>
      item.type === 'credential' && !!item.totp,
  );
  const credentials = matches.map((item) => ({
    id: item.id,
    name: item.name,
    username: item.username,
  }));

  const senderTyped = sender as { tab?: { id?: number; url?: string } } | undefined;
  if (senderTyped?.tab?.id) {
    const existing = ctx.tabAllowlists.get(senderTyped.tab.id) ?? new Set<string>();
    for (const m of matches) existing.add(m.id);
    ctx.tabAllowlists.set(senderTyped.tab.id, existing);
  }

  return { credentials };
}

// ---------------------------------------------------------------------------
// FILL_TOTP_CODE — derive the live TOTP code for one credential.
// Mirrors FILL_CREDENTIAL's allowlist + domain check; returns ONLY the
// 6-digit code, never the otpauth URI / Base32 secret.
// ---------------------------------------------------------------------------

export async function fillTotpCode(
  msg: { type: 'FILL_TOTP_CODE'; id: string },
  ctx: HandlerContext,
  sender?: unknown,
): Promise<unknown> {
  if (ctx.store.getState().status !== 'unlocked') return { error: 'Vault is locked' };

  const senderTyped = sender as { tab?: { id?: number; url?: string } } | undefined;
  const senderTabId = senderTyped?.tab?.id;
  if (!senderTabId) return { error: 'No sender tab' };

  const allowed = ctx.tabAllowlists.get(senderTabId);
  if (!allowed || !allowed.has(msg.id)) {
    return { error: 'Credential not in allowlist for this tab' };
  }

  const credential = ctx.store.getState().items.find((i) => i.id === msg.id);
  if (!credential || credential.type !== 'credential') {
    return { error: 'Credential not found' };
  }
  if (!credential.totp) {
    return { error: 'Credential has no TOTP secret' };
  }

  if (!senderTyped?.tab?.url || !credential.url) {
    return { error: 'Cannot verify domain match — credential or sender URL missing' };
  }
  let senderHostname: string;
  try {
    senderHostname = new URL(senderTyped.tab.url).hostname;
  } catch {
    return { error: 'Invalid sender tab URL' };
  }
  if (matchCredentialsByDomain(senderHostname, [credential]).length === 0) {
    return { error: 'Domain mismatch' };
  }

  let code: string;
  try {
    const params = parseTotpUri(credential.totp);
    code = generateTotpCode(params);
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Failed to generate TOTP code' };
  }

  return { code };
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
  const rejected = rejectIfExternal(sender);
  if (rejected) return rejected;
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
