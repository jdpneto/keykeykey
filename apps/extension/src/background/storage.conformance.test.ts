import { vi } from 'vitest';
import { createBrowserMock } from '../lib/browser-mock.js';
import { describePlatformStorageConformance } from '@keykeykey/core/testing';

const browserMock = createBrowserMock();
vi.mock('webextension-polyfill', () => ({ default: browserMock }));

const { createExtensionPlatformStorage } = await import('./storage.js');

describePlatformStorageConformance(
  'Extension',
  () => createExtensionPlatformStorage(),
  () => browserMock._reset(),
);
