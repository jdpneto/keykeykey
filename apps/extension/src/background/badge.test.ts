import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { VaultItem } from '@keykeykey/core';

// --- Browser mock ---
const actionMock = {
  setBadgeText: vi.fn().mockResolvedValue(undefined),
  setBadgeBackgroundColor: vi.fn().mockResolvedValue(undefined),
  setIcon: vi.fn().mockResolvedValue(undefined),
};

vi.mock('webextension-polyfill', () => ({
  default: { action: actionMock },
}));

const { updateBadge } = await import('./badge.js');

const makeCredential = (id: string, url: string, name: string): VaultItem =>
  ({
    id,
    type: 'credential',
    name,
    url,
    username: 'user',
    password: 'pass',
    tags: [],
    favorite: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }) as unknown as VaultItem;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('updateBadge', () => {
  it('clears badge and sets locked icon when vault is locked', async () => {
    await updateBadge('github.com', 'locked', [], 1);

    expect(actionMock.setBadgeText).toHaveBeenCalledWith({ tabId: 1, text: '' });
    expect(actionMock.setIcon).toHaveBeenCalledWith({
      tabId: 1,
      path: {
        16: 'icons/icon-locked-16.png',
        48: 'icons/icon-locked-48.png',
        128: 'icons/icon-locked-128.png',
      },
    });
  });

  it('shows green badge with match count when unlocked with matches', async () => {
    const items = [
      makeCredential('1', 'https://github.com', 'GitHub'),
      makeCredential('2', 'https://github.com/other', 'GitHub Work'),
    ];

    await updateBadge('github.com', 'unlocked', items, 5);

    expect(actionMock.setIcon).toHaveBeenCalledWith({
      tabId: 5,
      path: { 16: 'icons/icon-16.png', 48: 'icons/icon-48.png', 128: 'icons/icon-128.png' },
    });
    expect(actionMock.setBadgeText).toHaveBeenCalledWith({ tabId: 5, text: '2' });
    expect(actionMock.setBadgeBackgroundColor).toHaveBeenCalledWith({
      tabId: 5,
      color: '#22c55e',
    });
  });

  it('clears badge when unlocked with no matches', async () => {
    const items = [makeCredential('1', 'https://github.com', 'GitHub')];

    await updateBadge('example.com', 'unlocked', items, 3);

    expect(actionMock.setBadgeText).toHaveBeenCalledWith({ tabId: 3, text: '' });
    expect(actionMock.setBadgeBackgroundColor).not.toHaveBeenCalled();
  });

  it('clears badge when hostname is null', async () => {
    await updateBadge(null, 'unlocked', []);

    expect(actionMock.setBadgeText).toHaveBeenCalledWith({ text: '' });
  });
});
