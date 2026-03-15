import browser from 'webextension-polyfill';
import { createMessageHandler } from './message-handler.js';
import { updateBadge } from './badge.js';

const handler = createMessageHandler();

browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handler(message as Parameters<typeof handler>[0])
    .then(sendResponse)
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

browser.tabs.onActivated.addListener(async (activeInfo) => {
  const tab = await browser.tabs.get(activeInfo.tabId);
  const hostname = extractHostname(tab.url);
  // We cannot access store directly — call handler for status
  const status = (await handler({ type: 'GET_STATUS' })) as {
    status: string;
    itemCount: number;
  };
  if (status.status === 'unlocked') {
    const result = (await handler({ type: 'GET_ITEMS' })) as {
      items?: import('@keykeykey/core').VaultItem[];
    };
    await updateBadge(hostname, 'unlocked', result.items ?? [], activeInfo.tabId);
  } else {
    await updateBadge(hostname, status.status, [], activeInfo.tabId);
  }
});

browser.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (!changeInfo.url) return;
  const hostname = extractHostname(changeInfo.url);
  const status = (await handler({ type: 'GET_STATUS' })) as {
    status: string;
    itemCount: number;
  };
  if (status.status === 'unlocked') {
    const result = (await handler({ type: 'GET_ITEMS' })) as {
      items?: import('@keykeykey/core').VaultItem[];
    };
    await updateBadge(hostname, 'unlocked', result.items ?? [], tabId);
  } else {
    await updateBadge(hostname, status.status, [], tabId);
  }
});
