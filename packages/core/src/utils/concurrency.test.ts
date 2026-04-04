import { describe, it, expect, vi } from 'vitest';
import { pMap } from './concurrency.js';

describe('pMap', () => {
  it('processes all items with correct results', async () => {
    const items = [1, 2, 3, 4, 5];
    const results = await pMap(items, async (n) => n * 2);
    expect(results).toEqual([2, 4, 6, 8, 10]);
  });

  it('respects concurrency limit', async () => {
    let running = 0;
    let maxRunning = 0;
    const items = [1, 2, 3, 4, 5, 6];

    await pMap(
      items,
      async () => {
        running++;
        maxRunning = Math.max(maxRunning, running);
        await new Promise((r) => setTimeout(r, 10));
        running--;
      },
      2,
    );

    expect(maxRunning).toBeLessThanOrEqual(2);
  });

  it('calls onProgress after each item completes', async () => {
    const onProgress = vi.fn();
    const items = ['a', 'b', 'c'];

    await pMap(items, async (s) => s.toUpperCase(), 5, onProgress);

    expect(onProgress).toHaveBeenCalledTimes(3);
    expect(onProgress).toHaveBeenCalledWith(1, 3);
    expect(onProgress).toHaveBeenCalledWith(2, 3);
    expect(onProgress).toHaveBeenCalledWith(3, 3);
  });

  it('works without onProgress callback', async () => {
    const results = await pMap([1, 2], async (n) => n + 1);
    expect(results).toEqual([2, 3]);
  });

  it('onProgress completed count is monotonically increasing with concurrency=1', async () => {
    const calls: number[] = [];
    await pMap(
      [1, 2, 3, 4],
      async (n) => n,
      1,
      (completed) => calls.push(completed),
    );
    expect(calls).toEqual([1, 2, 3, 4]);
  });
});
