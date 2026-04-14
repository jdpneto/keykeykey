/**
 * Settings handlers: get/update settings, PIN management, password generation,
 * active tab URL, clipboard.
 */

import browser from 'webextension-polyfill';
import { generatePassword, calculateEntropy } from '@keykeykey/core';
import type { PasswordGeneratorOptions } from '@keykeykey/core';
import { toBase64 } from '@keykeykey/core/utils';
import { setupPin } from '@keykeykey/core/pin';
import { loadSettings, saveSettings, savePinData, clearPinData } from '../storage.js';
import type { HandlerContext } from '../context.js';
import type { Settings } from '../../lib/messages.js';

// ---------------------------------------------------------------------------
// GET_SETTINGS
// ---------------------------------------------------------------------------

export async function getSettings(
  _msg: { type: 'GET_SETTINGS' },
  _ctx: HandlerContext,
): Promise<unknown> {
  const settings = await loadSettings();
  return { settings };
}

// ---------------------------------------------------------------------------
// UPDATE_SETTINGS
// ---------------------------------------------------------------------------

export async function updateSettings(
  msg: { type: 'UPDATE_SETTINGS'; settings: Partial<Settings> },
  ctx: HandlerContext,
): Promise<unknown> {
  await saveSettings(msg.settings);

  // Reconfigure auto-lock if relevant settings changed
  if (ctx.autoLock && ('autoLockMode' in msg.settings || 'autoLockMinutes' in msg.settings)) {
    const settings = await loadSettings();
    ctx.autoLock.start(settings.autoLockMode, settings.autoLockMinutes);
  }

  return { ok: true };
}

// ---------------------------------------------------------------------------
// SET_PIN
// ---------------------------------------------------------------------------

export async function setPin(
  msg: { type: 'SET_PIN'; pin: string },
  ctx: HandlerContext,
): Promise<unknown> {
  if (ctx.store.getState().status !== 'unlocked') {
    return { error: 'Vault must be unlocked to set PIN' };
  }
  const dek = ctx.store.getState().getDEK();
  const { wrappedDEK, salt } = await setupPin(msg.pin, dek);
  await savePinData({
    pinHash: toBase64(wrappedDEK),
    salt: toBase64(salt),
    attemptsRemaining: 5,
  });
  return { ok: true };
}

// ---------------------------------------------------------------------------
// REMOVE_PIN
// ---------------------------------------------------------------------------

export async function removePin(
  _msg: { type: 'REMOVE_PIN' },
  _ctx: HandlerContext,
): Promise<unknown> {
  await clearPinData();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// GENERATE_PASSWORD
// ---------------------------------------------------------------------------

export async function generatePasswordHandler(
  msg: { type: 'GENERATE_PASSWORD'; options: PasswordGeneratorOptions },
  _ctx: HandlerContext,
): Promise<unknown> {
  const options = msg.options as PasswordGeneratorOptions;
  const password = generatePassword(options);
  const entropy = calculateEntropy(options);
  return { password, entropy };
}

// ---------------------------------------------------------------------------
// GET_ACTIVE_TAB_URL
// ---------------------------------------------------------------------------

export async function getActiveTabUrl(
  _msg: { type: 'GET_ACTIVE_TAB_URL' },
  _ctx: HandlerContext,
): Promise<unknown> {
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  const url = tabs[0]?.url ?? null;
  return { url };
}

// ---------------------------------------------------------------------------
// CAPTURE_VISIBLE_TAB — screenshot the active tab so the popup can decode
// QR codes shown on the page (used by the TOTP "Scan QR from page" button).
// ---------------------------------------------------------------------------

export async function captureVisibleTab(
  _msg: { type: 'CAPTURE_VISIBLE_TAB' },
  _ctx: HandlerContext,
): Promise<unknown> {
  const dataUrl = await browser.tabs.captureVisibleTab(undefined as never, { format: 'png' });
  return { dataUrl };
}

// ---------------------------------------------------------------------------
// CLIPBOARD_COPIED
// ---------------------------------------------------------------------------

export async function clipboardCopied(
  _msg: { type: 'CLIPBOARD_COPIED' },
  ctx: HandlerContext,
): Promise<unknown> {
  ctx.scheduleClipboardClear();
  return { ok: true };
}
