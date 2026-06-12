/**
 * Generate a unique name by finding the highest numeric suffix matching a
 * pattern among existing items and incrementing it.
 *
 * @param existingItems - Array of objects with an optional `name` property.
 * @param prefix        - Name prefix (e.g. 'reg', 'field', 'ARRAY_').
 * @param pattern       - Optional regex with a single capture group for the
 *                        numeric suffix. Defaults to `/^{prefix}(\d+)$/i`.
 */
export function generateUniqueName(
  existingItems: { name?: string | null }[],
  prefix: string,
  pattern?: RegExp
): string {
  const re = pattern ?? new RegExp(`^${prefix}(\\d+)$`, 'i');
  let maxN = 0;
  for (const item of existingItems) {
    const match = String(item.name ?? '').match(re);
    if (match) {
      maxN = Math.max(maxN, parseInt(match[1], 10));
    }
  }
  return `${prefix}${maxN + 1}`;
}
