import browser from 'webextension-polyfill';
import { createMessageHandler } from './message-handler.js';

const handler = createMessageHandler();

browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handler(message as Parameters<typeof handler>[0])
    .then(sendResponse)
    .catch((err) => {
      sendResponse({ error: err instanceof Error ? err.message : 'Unknown error' });
    });
  return true; // async response
});
