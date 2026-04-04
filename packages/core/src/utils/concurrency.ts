/**
 * Run async tasks with bounded concurrency, similar to p-map.
 *
 * @param items  - Array of inputs to process
 * @param fn     - Async function to apply to each item
 * @param concurrency - Maximum number of tasks running at once (default 5)
 * @param onProgress  - Called after each item completes with (completedCount, totalCount)
 * @returns Array of results in the same order as the input
 */
export async function pMap<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>,
  concurrency = 5,
  onProgress?: (completed: number, total: number) => void,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let index = 0;
  let completed = 0;

  async function worker() {
    while (index < items.length) {
      const i = index++;
      results[i] = await fn(items[i]!);
      completed++;
      onProgress?.(completed, items.length);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}
