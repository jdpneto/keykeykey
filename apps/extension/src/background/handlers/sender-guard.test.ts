/**
 * Tests for `isFromOurExtension` / `rejectIfExternal`.
 *
 * The previous guard rejected every sender where `sender.tab` existed, which
 * accidentally blocked the popup whenever it was opened as a regular tab
 * (right-click → "Open in new tab", Playwright navigating directly to
 * `chrome-extension://<id>/src/popup/index.html`, future Options pages).
 * These tests pin the fix in place.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('webextension-polyfill', () => ({
  default: { runtime: { id: 'test-extension-id' } },
}));

import { isFromOurExtension, rejectIfExternal } from './sender-guard.js';

describe('isFromOurExtension', () => {
  it('returns true for background senders (no tab)', () => {
    expect(isFromOurExtension({})).toBe(true);
    expect(isFromOurExtension(undefined)).toBe(true);
  });

  it('returns true when tab.url is served by our extension (popup-as-tab)', () => {
    expect(
      isFromOurExtension({
        tab: { id: 1, url: 'chrome-extension://test-extension-id/src/popup/index.html' },
      }),
    ).toBe(true);
  });

  it('returns false for content scripts on the open web', () => {
    expect(
      isFromOurExtension({
        tab: { id: 1, url: 'https://example.com/login' },
      }),
    ).toBe(false);
  });

  it('returns false when tab is from a different extension', () => {
    expect(
      isFromOurExtension({
        tab: { id: 1, url: 'chrome-extension://some-other-id/popup.html' },
      }),
    ).toBe(false);
  });

  it('falls back to sender.url when tab has no url', () => {
    expect(
      isFromOurExtension({
        tab: { id: 1 },
        url: 'chrome-extension://test-extension-id/src/popup/index.html',
      }),
    ).toBe(true);
  });
});

describe('rejectIfExternal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null when the sender is our extension', () => {
    expect(rejectIfExternal(undefined)).toBeNull();
    expect(
      rejectIfExternal({
        tab: { id: 1, url: 'chrome-extension://test-extension-id/src/popup/index.html' },
      }),
    ).toBeNull();
  });

  it('returns a rejection object for web-page senders', () => {
    expect(
      rejectIfExternal({ tab: { id: 1, url: 'https://attacker.example/' } }),
    ).toEqual({ error: 'Not allowed from content scripts' });
  });
});
