import { describe, it, expect, afterEach } from 'vitest';
import { getBrowserKind } from './browser-detect.js';

describe('getBrowserKind', () => {
  const originalNavigator = globalThis.navigator;

  afterEach(() => {
    Object.defineProperty(globalThis, 'navigator', {
      value: originalNavigator,
      configurable: true,
      writable: true,
    });
  });

  function setUserAgent(ua: string): void {
    Object.defineProperty(globalThis, 'navigator', {
      value: { userAgent: ua },
      configurable: true,
      writable: true,
    });
  }

  it('returns "firefox" for Firefox user agents', () => {
    setUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:121.0) Gecko/20100101 Firefox/121.0',
    );
    expect(getBrowserKind()).toBe('firefox');
  });

  it('returns "safari" for Safari user agents without Chrome', () => {
    setUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
    );
    expect(getBrowserKind()).toBe('safari');
  });

  it('does not return "safari" for Chrome (which has both "Safari" and "Chrome" in UA)', () => {
    setUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    );
    expect(getBrowserKind()).toBe('chrome');
  });

  it('returns "chrome" for a plain Chromium user agent', () => {
    setUserAgent(
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    );
    expect(getBrowserKind()).toBe('chrome');
  });

  it('returns "chrome" when navigator is undefined (e.g., worker-like contexts)', () => {
    Object.defineProperty(globalThis, 'navigator', {
      value: undefined,
      configurable: true,
      writable: true,
    });
    expect(getBrowserKind()).toBe('chrome');
  });
});
