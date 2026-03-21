import browser from 'webextension-polyfill';
import type { AutoLockMode } from '../lib/messages.js';

const ALARM_NAME = 'auto-lock';
const KEEPALIVE_ALARM = 'keepalive';
// Chrome MV3 kills service workers after ~30s of inactivity.
// A periodic alarm every 25s keeps the worker alive while the vault is unlocked.
const KEEPALIVE_PERIOD_MINUTES = 25 / 60; // 25 seconds

export class AutoLockManager {
  private onLock: () => void;
  private mode: AutoLockMode = 'timed';
  private minutes = 60;
  private windowRemovedHandler: ((windowId: number) => void) | null = null;
  private alarmHandler: (alarm: { name: string }) => void;

  constructor(onLock: () => void) {
    this.onLock = onLock;
    this.alarmHandler = (alarm: { name: string }) => {
      if (alarm.name === ALARM_NAME) {
        this.onLock();
      }
      // KEEPALIVE_ALARM is intentionally a no-op — it just wakes the service worker
    };
    browser.alarms.onAlarm.addListener(this.alarmHandler);
  }

  start(mode: AutoLockMode, minutes: number): void {
    this.mode = mode;
    this.minutes = minutes;
    this._clearTimers();

    // Start keepalive to prevent MV3 service worker termination
    browser.alarms.create(KEEPALIVE_ALARM, { periodInMinutes: KEEPALIVE_PERIOD_MINUTES });

    if (mode === 'timed') {
      browser.alarms.create(ALARM_NAME, { delayInMinutes: minutes });
    } else if (mode === 'browser_close') {
      this.windowRemovedHandler = () => {
        browser.windows.getAll().then((windows: unknown[]) => {
          if (windows.length === 0) this.onLock();
        });
      };
      browser.windows.onRemoved.addListener(this.windowRemovedHandler);
    }
  }

  resetTimer(): void {
    if (this.mode === 'timed') {
      browser.alarms.clear(ALARM_NAME);
      browser.alarms.create(ALARM_NAME, { delayInMinutes: this.minutes });
    }
  }

  stop(): void {
    this._clearTimers();
    browser.alarms.onAlarm.removeListener(this.alarmHandler);
  }

  private _clearTimers(): void {
    browser.alarms.clear(ALARM_NAME);
    browser.alarms.clear(KEEPALIVE_ALARM);
    if (this.windowRemovedHandler) {
      browser.windows.onRemoved.removeListener(this.windowRemovedHandler);
      this.windowRemovedHandler = null;
    }
  }
}
