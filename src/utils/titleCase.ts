/**
 * Title-cases a snake_case or SCREAMING_SNAKE_CASE identifier for display:
 * `DATA_WIDTH` -> `Data Width`.
 *
 * Matches Nunjucks' `title` filter (which lower-cases the rest of each word),
 * so a generated label and a label reconstructed by an importer agree
 * character for character. That equality is what lets `HwTclParser` tell an
 * author-supplied `displayName` apart from a generator's fallback.
 */
export function titleCaseIdentifier(name: string): string {
  return name
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
