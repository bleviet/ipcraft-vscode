/** Pure search stepping over a {@link SystemGraph}: match order, wrap-around, counter text. */

import type { SystemGraph } from '../../domain/systemGraph';
import { levelOf, matchesQuery, type Selection } from './model';
import type { TextMatcher } from './searchMatcher';

/** Instance paths matching the search on every level, in outline order (a hierarchy before its children). */
export function searchMatches(graph: SystemGraph, matcher: TextMatcher | null): string[] {
  if (!matcher) {
    return [];
  }
  const matches: string[] = [];
  const visit = (levelPath: string): void => {
    for (const path of graph.levels[levelPath]?.instances ?? []) {
      const instance = graph.instances[path];
      if (!instance) {
        continue;
      }
      if (matchesQuery(instance, matcher)) {
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

/** `matches` and every hierarchy above one: the rows the Outline keeps while a search is on. */
export function withAncestors(matches: readonly string[]): Set<string> {
  const shown = new Set<string>();
  for (const match of matches) {
    for (let path = match; path !== '/' && !shown.has(path); path = levelOf(path)) {
      shown.add(path);
    }
  }
  return shown;
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

/** Counter text while a search is on. */
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

/**
 * Text Ctrl+F puts in the search box, as VS Code seeds its find widget from the
 * selection: the name of the selected instance, unless the search already
 * matches it (it was reached by stepping through the matches). Undefined
 * keeps the query.
 */
export function findSeed(
  graph: SystemGraph,
  matcher: TextMatcher | null,
  selection: Selection | null
): string | undefined {
  const instance = selection?.kind === 'instance' ? graph.instances[selection.id] : undefined;
  if (!instance || (matcher && matchesQuery(instance, matcher))) {
    return undefined;
  }
  return instance.name;
}
