/**
 * Guard helpers for background message handlers.
 *
 * The legacy check `if (sender.tab) return 'Not allowed from content scripts'`
 * wrongly rejects the popup whenever it's loaded as a regular tab (e.g. via
 * right-click → "Open in new tab", Playwright navigating directly to
 * `chrome-extension://<id>/src/popup/index.html`, or a future Options page).
 *
 * The real intent is "reject callers running under a *web-page* origin."
 * So we let the message through whenever `sender.tab.url` is under our own
 * extension origin, and otherwise still block.
 */
import browser from 'webextension-polyfill';
import type { Runtime } from 'webextension-polyfill';

/**
 * Returns true when the message originates from our background worker or any
 * page served by this extension (action-popup, popup-as-tab, options page,
 * etc.). Returns false for content scripts running on the open web.
 */
export function isFromOurExtension(sender?: unknown): boolean {
  const s = sender as Runtime.MessageSender | undefined;
  // No tab => background or action-popup. Always our own context.
  if (!s?.tab) return true;

  // Tab exists. Accept when its URL is served by this extension.
  const url = s.tab.url ?? s.url ?? '';
  const ownOrigin = `chrome-extension://${browser.runtime.id}/`;
  return url.startsWith(ownOrigin);
}

/**
 * Convenience wrapper: returns the content-script rejection object when the
 * caller is NOT trusted, or `null` when the handler should proceed.
 */
export function rejectIfExternal(
  sender?: unknown,
): { error: string } | null {
  return isFromOurExtension(sender) ? null : { error: 'Not allowed from content scripts' };
}
