import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { copyWithAutoClear } from '../clipboard';

const clipboard = navigator.clipboard as unknown as {
  writeText: ReturnType<typeof vi.fn>;
  readText: ReturnType<typeof vi.fn>;
};

describe('copyWithAutoClear', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    clipboard.writeText.mockResolvedValue(undefined);
    clipboard.readText.mockResolvedValue('');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('still clears after the timeout when delayed clipboard reads are denied', async () => {
    clipboard.readText.mockRejectedValue(new Error('clipboard read denied'));

    await copyWithAutoClear('secret', 1_000);

    expect(clipboard.writeText).toHaveBeenCalledWith('secret');

    await vi.advanceTimersByTimeAsync(1_000);

    expect(clipboard.writeText).toHaveBeenLastCalledWith('');
  });
});
