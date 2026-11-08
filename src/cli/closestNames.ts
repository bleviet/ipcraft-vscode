/** Levenshtein distance between `a` and `b`. */
function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row.push(
        Math.min(previous[j] + 1, row[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
      );
    }
    previous = row;
  }
  return previous[b.length];
}

/** Up to `limit` of `candidates` nearest to `name`: prefix and substring matches first, then by edit distance. */
export function closestNames(name: string, candidates: readonly string[], limit = 3): string[] {
  const wanted = name.toLowerCase();
  const score = (candidate: string): number => {
    const text = candidate.toLowerCase();
    if (text.startsWith(wanted) || wanted.startsWith(text)) {
      return 0;
    }
    return text.includes(wanted) ? 1 : 2 + editDistance(wanted, text);
  };
  return [...candidates].sort((a, b) => score(a) - score(b) || a.localeCompare(b)).slice(0, limit);
}
