import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createBrowserMock } from '../lib/browser-mock.js';

const browserMock = createBrowserMock();
vi.mock('webextension-polyfill', () => ({ default: browserMock }));

const { AutoLockManager } = await import('./auto-lock.js');

describe('AutoLockManager', () => {
  let lockCallback: ReturnType<typeof vi.fn>;
  let manager: InstanceType<typeof AutoLockManager>;

  beforeEach(() => {
    browserMock._reset();
    lockCallback = vi.fn();
    manager = new AutoLockManager(lockCallback);
  });

  it('should create an alarm when started in timed mode', async () => {
    manager.start('timed', 15);
    const alarm = await browserMock.alarms.get('auto-lock');
    expect(alarm).not.toBeNull();
  });

  it('should reset the alarm on activity', async () => {
    manager.start('timed', 15);
    manager.resetTimer();
    const alarm = await browserMock.alarms.get('auto-lock');
    expect(alarm).not.toBeNull();
  });

  it('should call lock callback when alarm fires', () => {
    manager.start('timed', 15);
    browserMock.alarms._fire('auto-lock');
    expect(lockCallback).toHaveBeenCalled();
  });

  it('should not create alarm in never mode', async () => {
    manager.start('never', 15);
    const alarm = await browserMock.alarms.get('auto-lock');
    expect(alarm).toBeNull();
  });

  it('should clear alarm on stop', async () => {
    manager.start('timed', 15);
    manager.stop();
    const alarm = await browserMock.alarms.get('auto-lock');
    expect(alarm).toBeNull();
  });

  it('should not call lock for non-auto-lock alarms', () => {
    manager.start('timed', 15);
    browserMock.alarms._fire('some-other-alarm');
    expect(lockCallback).not.toHaveBeenCalled();
  });
});
