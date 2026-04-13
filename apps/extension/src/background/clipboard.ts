import browser from 'webextension-polyfill';
import { getBrowserKind } from '../lib/browser-detect.js';

const CLIPBOARD_ALARM = 'clipboard-clear';

/**
 * Set up the clipboard-clear alarm listener.
 *
 * When the alarm fires:
 *   - Chrome: create a short-lived offscreen document that clears the
 *     clipboard (MV3 service workers have no DOM).
 *   - Firefox: call navigator.clipboard.writeText directly from the
 *     background event page (Firefox 121+ with clipboardWrite permission).
 *
 * Both paths are best-effort security hardening — `try`/`catch` swallows
 * failures (e.g., offscreen document already exists, Clipboard API rejected
 * for lack of focus).
 */
export function setupClipboardClear(): void {
  browser.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name !== CLIPBOARD_ALARM) return;

    if (getBrowserKind() === 'firefox') {
      try {
        await navigator.clipboard.writeText('');
      } catch {
        // Clipboard API may reject if no document is focused — acceptable
      }
      return;
    }

    // Chrome path — offscreen document
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (browser as any).offscreen?.createDocument({
        url: 'offscreen/clipboard-clear.html',
        reasons: ['CLIPBOARD'],
        justification: 'Clear clipboard after copy timeout',
      });
    } catch {
      // Offscreen document may already exist
    }
  });
}

/**
 * Schedule clipboard clearing in 30 seconds.
 */
export function scheduleClipboardClear(): void {
  browser.alarms.clear(CLIPBOARD_ALARM);
  browser.alarms.create(CLIPBOARD_ALARM, { delayInMinutes: 0.5 });
}
