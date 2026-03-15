import browser from 'webextension-polyfill';
import { matchCredentialsByDomain } from '@keykeykey/core';
import type { VaultItem } from '@keykeykey/core';

export async function updateBadge(
  hostname: string | null,
  vaultStatus: string,
  items: VaultItem[],
  tabId?: number,
): Promise<void> {
  const target = tabId ? { tabId } : {};

  if (vaultStatus !== 'unlocked') {
    await browser.action.setBadgeText({ ...target, text: '' });
    // Use locked icon variant
    try {
      await browser.action.setIcon({
        ...target,
        path: {
          16: 'icons/icon-locked-16.png',
          48: 'icons/icon-locked-48.png',
          128: 'icons/icon-locked-128.png',
        },
      });
    } catch {
      /* icon paths may not exist yet */
    }
    return;
  }

  // Restore normal icon
  try {
    await browser.action.setIcon({
      ...target,
      path: { 16: 'icons/icon-16.png', 48: 'icons/icon-48.png', 128: 'icons/icon-128.png' },
    });
  } catch {
    /* ignore */
  }

  if (!hostname) {
    await browser.action.setBadgeText({ ...target, text: '' });
    return;
  }

  const matches = matchCredentialsByDomain(hostname, items);
  if (matches.length > 0) {
    await browser.action.setBadgeText({ ...target, text: String(matches.length) });
    await browser.action.setBadgeBackgroundColor({ ...target, color: '#22c55e' });
  } else {
    await browser.action.setBadgeText({ ...target, text: '' });
  }
}
