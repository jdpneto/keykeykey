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

// Mock `getURL` alongside `id` — the guard uses `getURL('/')` to build the
// accepted origin prefix so it works on both Chromium
// (`chrome-extension://<id>/`) and Firefox (`moz-extension://<uuid>/`).
vi.mock('webextension-polyfill', () => ({
  default: {
    runtime: {
      id: 'test-extension-id',
      getURL: (path: string) => `chrome-extension://test-extension-id${path}`,
    },
  },
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

  it('returns true for Firefox moz-extension URLs when getURL returns one', async () => {
    // Simulate the Firefox build where runtime.getURL returns
    // `moz-extension://<uuid>/`. vi.mocked() patches the module's
    // getURL to match that scheme for this test only.
    const browserMod = (await import('webextension-polyfill')).default as {
      runtime: { id: string; getURL: (path: string) => string };
    };
    const originalGetURL = browserMod.runtime.getURL;
    browserMod.runtime.getURL = (path: string) =>
      `moz-extension://e7c5d2a0-1234-5678-9abc-def012345678${path}`;
    try {
      expect(
        isFromOurExtension({
          tab: {
            id: 1,
            url: 'moz-extension://e7c5d2a0-1234-5678-9abc-def012345678/src/popup/index.html',
          },
        }),
      ).toBe(true);
    } finally {
      browserMod.runtime.getURL = originalGetURL;
    }
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
    expect(rejectIfExternal({ tab: { id: 1, url: 'https://attacker.example/' } })).toEqual({
      error: 'Not allowed from content scripts',
    });
  });
});
