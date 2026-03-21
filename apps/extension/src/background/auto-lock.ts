import browser from 'webextension-polyfill';
import type { AutoLockMode } from '../lib/messages.js';

const ALARM_NAME = 'auto-lock';

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
    };
    browser.alarms.onAlarm.addListener(this.alarmHandler);
  }

  start(mode: AutoLockMode, minutes: number): void {
    this.mode = mode;
    this.minutes = minutes;
    // Clear previous timers/listeners without removing the alarm event listener
    this._clearTimers();

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
    if (this.windowRemovedHandler) {
      browser.windows.onRemoved.removeListener(this.windowRemovedHandler);
      this.windowRemovedHandler = null;
    }
  }
}
