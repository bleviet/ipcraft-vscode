/**
 * Runs `fn` over `items` with at most `limit` calls in flight at once,
 * returning results in input order. Used for I/O-bound fan-out (reading and
 * parsing many small files) where unbounded `Promise.all` would open too many
 * file handles at once and serial `for await` would be needlessly slow.
 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array<R>(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const i = next++;
      if (i >= items.length) {
        return;
      }
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
