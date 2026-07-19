/** Converts user-authored labels into a schema-valid stable ID. */
export function sanitizeStableId(value: string, fallback = 'id'): string {
  const sanitized = value.trim().replace(/[^A-Za-z0-9._-]+/g, '-');
  if (/^[A-Za-z0-9]/.test(sanitized)) {
    return sanitized;
  }
  const suffix = sanitized.replace(/^[._-]+/, '');
  return suffix ? `${fallback}-${suffix}` : fallback;
}

/** Returns a schema-valid ID that does not collide with the recipe-wide ID namespace. */
export function uniqueStableId(preferred: string, existingIds: ReadonlySet<string>): string {
  const base = sanitizeStableId(preferred);
  let candidate = base;
  let suffix = 2;
  while (existingIds.has(candidate)) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}
