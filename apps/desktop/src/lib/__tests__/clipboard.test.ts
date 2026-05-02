import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { copyWithAutoClear } from '../clipboard';

const clipboard = navigator.clipboard as unknown as {
  writeText: ReturnType<typeof vi.fn>;
  readText: ReturnType<typeof vi.fn>;
};
const invokeMock = vi.mocked(invoke);

describe('copyWithAutoClear', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    invokeMock.mockResolvedValue(undefined);
    clipboard.writeText.mockResolvedValue(undefined);
    clipboard.readText.mockResolvedValue('');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('clears after the timeout through the native desktop clipboard command', async () => {
    clipboard.readText.mockRejectedValue(new Error('clipboard read denied'));

    await copyWithAutoClear('secret', 1_000);

    expect(clipboard.writeText).toHaveBeenCalledWith('secret');

    await vi.advanceTimersByTimeAsync(1_000);

    expect(invokeMock).toHaveBeenCalledWith('clear_clipboard');
    expect(clipboard.writeText).toHaveBeenCalledTimes(1);
  });

  it('falls back to a web clipboard clear if the native command fails', async () => {
    invokeMock.mockRejectedValue(new Error('native clipboard unavailable'));

    await copyWithAutoClear('secret', 1_000);
    await vi.advanceTimersByTimeAsync(1_000);

    expect(invokeMock).toHaveBeenCalledWith('clear_clipboard');
    expect(clipboard.writeText).toHaveBeenNthCalledWith(1, 'secret');
    expect(clipboard.writeText).toHaveBeenNthCalledWith(2, '');
  });
});
