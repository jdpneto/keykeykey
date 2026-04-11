/**
 * Returns the browser kind this extension is running in.
 *
 * Detection is based on `navigator.userAgent`, the same approach used by
 * `webextension-polyfill` consumers across the codebase. Returns `'chrome'`
 * as a safe default when `navigator` is unavailable (e.g., SSR, test harness,
 * or exotic worker contexts).
 *
 * Used for runtime branching on Chrome-only APIs:
 *   - `chrome.identity.getAuthToken` vs `launchWebAuthFlow` (Google OAuth)
 *   - `chrome.offscreen` vs direct `navigator.clipboard` (clipboard auto-clear)
 *   - Chrome-only restore flow shortcut (Google silent consent)
 */
export type BrowserKind = 'chrome' | 'firefox' | 'safari';

export function getBrowserKind(): BrowserKind {
  if (typeof navigator === 'undefined') return 'chrome';
  const ua = navigator.userAgent;
  if (ua.includes('Firefox')) return 'firefox';
  if (ua.includes('Safari') && !ua.includes('Chrome')) return 'safari';
  return 'chrome';
}
