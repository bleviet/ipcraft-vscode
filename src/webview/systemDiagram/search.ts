/** Pure search stepping over a {@link SystemGraph}: match order, wrap-around, counter text. */

import type { SystemGraph } from '../../domain/systemGraph';
import { matchesQuery } from './model';

/** Instance paths matching `query` on every level, in outline order (a hierarchy before its children). */
export function searchMatches(graph: SystemGraph, query: string): string[] {
  if (query.trim() === '') {
    return [];
  }
  const matches: string[] = [];
  const visit = (levelPath: string): void => {
    for (const path of graph.levels[levelPath]?.instances ?? []) {
      const instance = graph.instances[path];
      if (!instance) {
        continue;
      }
      if (matchesQuery(instance, query)) {
        matches.push(path);
      }
      if (instance.kind === 'hier') {
        visit(path);
      }
    }
  };
  visit('/');
  return matches;
}

/** The match after (1) or before (-1) `currentId`, wrapping; the first or last when `currentId` is not a match. */
export function stepMatch(
  matches: readonly string[],
  currentId: string | undefined,
  direction: 1 | -1
): string | undefined {
  if (matches.length === 0) {
    return undefined;
  }
  const index = currentId === undefined ? -1 : matches.indexOf(currentId);
  if (index < 0) {
    return direction === 1 ? matches[0] : matches[matches.length - 1];
  }
  return matches[(index + direction + matches.length) % matches.length];
}

/** Counter text for a non-blank query. */
export function matchCounter(matches: readonly string[], currentId: string | undefined): string {
  if (matches.length === 0) {
    return 'No results';
  }
  const index = currentId === undefined ? -1 : matches.indexOf(currentId);
  if (index >= 0) {
    return `${index + 1} of ${matches.length}`;
  }
  return matches.length === 1 ? '1 match' : `${matches.length} matches`;
}
