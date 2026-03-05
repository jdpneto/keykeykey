// Background service worker for KeyKeyKey browser extension.
// Responsibilities:
// - Hold the unlocked DEK in memory while the browser is open
// - Handle auto-locking timeouts (configurable, default 15 minutes)
// - Respond to popup and content script messages

chrome.runtime.onInstalled.addListener(() => {
  console.log('KeyKeyKey extension installed.');
});
