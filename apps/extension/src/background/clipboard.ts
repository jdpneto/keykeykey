import browser from 'webextension-polyfill';

const CLIPBOARD_ALARM = 'clipboard-clear';

/**
 * Set up the clipboard-clear alarm listener.
 * When the alarm fires, creates a short-lived offscreen document
 * to clear the clipboard (Manifest V3 pattern).
 */
export function setupClipboardClear(): void {
  browser.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name !== CLIPBOARD_ALARM) return;

    try {
      // Offscreen API is Chrome-only; Firefox/Safari degrade gracefully
      await (browser as any).offscreen?.createDocument({
        url: 'offscreen/clipboard-clear.html',
        reasons: ['CLIPBOARD'],
        justification: 'Clear clipboard after copy timeout',
      });
    } catch {
      // Offscreen document may already exist or not be supported
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
