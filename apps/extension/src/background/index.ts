import browser from 'webextension-polyfill';
import { createHandlerContext } from './context.js';
import { routeMessage } from './router.js';
import { updateBadge } from './badge.js';
import type { ContentPushMessage } from '../lib/messages.js';

const ctx = createHandlerContext();
let initPromise: Promise<void> | null = ctx.init();

// ---------------------------------------------------------------------------
// Push notifications to all content scripts
// ---------------------------------------------------------------------------

async function notifyContentScripts(message: ContentPushMessage): Promise<void> {
  const tabs = await browser.tabs.query({});
  for (const tab of tabs) {
    if (tab.id) browser.tabs.sendMessage(tab.id, message).catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Message listener (popup + content scripts)
// ---------------------------------------------------------------------------

browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const msg = message as { type: string };

  (async () => {
    // Wait for init on first message
    if (initPromise) {
      await initPromise;
      initPromise = null;
    }

    // Reset auto-lock timer on every message
    ctx.autoLock?.resetTimer();

    return routeMessage(msg, ctx, sender);
  })()
    .then(async (result) => {
      // Push notifications for vault state changes
      if (msg.type === 'LOCK') {
        ctx.tabAllowlists.clear();
        notifyContentScripts({ type: 'VAULT_LOCKED' });
      }
      if (msg.type === 'UNLOCK' || msg.type === 'UNLOCK_PIN') {
        const r = result as Record<string, unknown>;
        if (!r.error) {
          notifyContentScripts({ type: 'VAULT_UNLOCKED' });
        }
      }
      if (
        msg.type === 'ADD_ITEM' ||
        msg.type === 'UPDATE_ITEM' ||
        msg.type === 'DELETE_ITEM' ||
        msg.type === 'SAVE_CREDENTIAL' ||
        msg.type === 'UPDATE_CREDENTIAL' ||
        msg.type === 'IMPORT_ITEMS'
      ) {
        const r = result as Record<string, unknown>;
        if (!r.error) {
          notifyContentScripts({ type: 'VAULT_CHANGED' });

          // Sync immediately — except IMPORT_ITEMS which handles its own sync
          if (msg.type !== 'IMPORT_ITEMS') {
            // The core's scheduleSync uses a 2s setTimeout which may not fire
            // before the MV3 service worker is terminated. Await keeps the
            // message listener's promise chain alive.
            await routeMessage({ type: 'TRIGGER_SYNC' }, ctx).catch(() => {});
          }
        }
      }
      sendResponse(result);
    })
    .catch((err) => {
      sendResponse({ error: err instanceof Error ? err.message : 'Unknown error' });
    });
  return true; // async response
});

// ---------------------------------------------------------------------------
// Badge: update on tab activation / navigation
// ---------------------------------------------------------------------------

function extractHostname(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

async function refreshBadge(hostname: string | null, tabId: number): Promise<void> {
  const status = (await routeMessage({ type: 'GET_STATUS' }, ctx)) as {
    status: string;
    itemCount: number;
  };
  if (status.status === 'unlocked') {
    const result = (await routeMessage({ type: 'GET_ITEMS' }, ctx)) as {
      items?: import('@keykeykey/core').VaultItem[];
    };
    await updateBadge(hostname, 'unlocked', result.items ?? [], tabId);
  } else {
    await updateBadge(hostname, status.status, [], tabId);
  }
}

browser.tabs.onActivated.addListener(async (activeInfo) => {
  const tab = await browser.tabs.get(activeInfo.tabId);
  const hostname = extractHostname(tab.url);
  await refreshBadge(hostname, activeInfo.tabId);
});

browser.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.url) {
    // Clear allowlist for tab on URL change
    ctx.tabAllowlists.delete(tabId);
  }

  if (changeInfo.url || changeInfo.status === 'complete') {
    const hostname = extractHostname(changeInfo.url ?? tab.url);
    await refreshBadge(hostname, tabId);
  }
});
