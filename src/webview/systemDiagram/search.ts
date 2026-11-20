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

/** Every hierarchy path strictly above `path`, nearest first (never `/`). */
function ancestorsOf(path: string): string[] {
  const ancestors: string[] = [];
  for (let ancestor = levelOf(path); ancestor !== '/'; ancestor = levelOf(ancestor)) {
    ancestors.push(ancestor);
  }
  return ancestors;
}

/** `matches` and every hierarchy above one: the rows the Outline keeps while a search is on. */
export function withAncestors(matches: readonly string[]): Set<string> {
  const shown = new Set<string>();
  for (const match of matches) {
    shown.add(match);
    for (const ancestor of ancestorsOf(match)) {
      shown.add(ancestor);
    }
  }
  return shown;
}

/** For every hierarchy above a match, the number of matches anywhere below it. */
export function matchesInside(matches: readonly string[]): Map<string, number> {
  const inside = new Map<string, number>();
  for (const match of matches) {
    for (const ancestor of ancestorsOf(match)) {
      inside.set(ancestor, (inside.get(ancestor) ?? 0) + 1);
    }
  }
  return inside;
}

/** Text of the "matches inside" badge: the count, capped at 99+. */
export function insideBadgeText(count: number): string {
  return count > 99 ? '99+' : String(count);
}

/** What the results list shows of one match. */
export interface ResultRow {
  name: string;
  type?: string;
}

export interface MatchGroup {
  /** The level the matches are instances of. */
  level: string;
  label: string;
  paths: string[];
}

/** `matches` grouped by their level, in order of first appearance. */
export function groupMatches(graph: SystemGraph, matches: readonly string[]): MatchGroup[] {
  const groups = new Map<string, MatchGroup>();
  for (const path of matches) {
    const level = levelOf(path);
    let group = groups.get(level);
    if (!group) {
      group = {
        level,
        label: level === '/' ? graph.name : level.split('/').filter(Boolean).join(' / '),
        paths: [],
      };
      groups.set(level, group);
    }
    group.paths.push(path);
  }
  return [...groups.values()];
}

/** Header line of the results list. */
export function resultsSummary(groups: readonly MatchGroup[]): string {
  const total = groups.reduce((sum, group) => sum + group.paths.length, 0);
  return `${total === 1 ? '1 match' : `${total} matches`} in ${
    groups.length === 1 ? '1 level' : `${groups.length} levels`
  }`;
}

/** Above this many matches the results list starts with its groups collapsed. */
export const COLLAPSE_THRESHOLD = 20;

/** Levels of the groups the results list starts collapsed: all but the one with `currentId`, on a long list. */
export function initiallyCollapsed(
  groups: readonly MatchGroup[],
  currentId: string | undefined
): Set<string> {
  const total = groups.reduce((sum, group) => sum + group.paths.length, 0);
  if (total <= COLLAPSE_THRESHOLD) {
    return new Set();
  }
  return new Set(
    groups
      .filter((group) => currentId === undefined || !group.paths.includes(currentId))
      .map((group) => group.level)
  );
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
