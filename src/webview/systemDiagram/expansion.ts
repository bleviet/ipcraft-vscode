/**
 * Pure rules of in-place expansion: a hierarchy block drawn as a frame around
 * its inner level. `expanded` holds the instance paths of the expanded blocks;
 * a hierarchy instance shares its path with its level key in the graph.
 */

import type { SystemGraph } from '../../domain/systemGraph';
import { isLevelNode, selectionLevel, type Selection } from './model';

/** `levelPath` plus, recursively, every expanded hierarchy block on a shown level. */
export function shownLevels(
  graph: SystemGraph,
  levelPath: string,
  expanded: ReadonlySet<string>
): Set<string> {
  const shown = new Set<string>();
  const visit = (level: string) => {
    shown.add(level);
    for (const path of graph.levels[level]?.instances ?? []) {
      if (expanded.has(path) && graph.instances[path]?.kind === 'hier') {
        visit(path);
      }
    }
  };
  visit(levelPath);
  return shown;
}

/**
 * Whether the node is drawn: an instance when its level is shown (inside an
 * expanded frame or on `levelPath`), a boundary pin only on `levelPath` itself,
 * as the boundary pins of an expanded level are the pins of its frame.
 */
export function isShownNode(
  graph: SystemGraph,
  levelPath: string,
  expanded: ReadonlySet<string>,
  nodeId: string
): boolean {
  const instance = graph.instances[nodeId];
  return instance
    ? shownLevels(graph, levelPath, expanded).has(instance.parent)
    : isLevelNode(graph, levelPath, nodeId);
}

/**
 * Level to show for `selection`: `levelPath` when the selection is already
 * visible there (nodes and nets inside an expanded frame count), else the level
 * it belongs to.
 */
export function viewLevel(
  graph: SystemGraph,
  levelPath: string,
  expanded: ReadonlySet<string>,
  selection: Selection
): string | undefined {
  if (selection.kind === 'net') {
    const level = selectionLevel(graph, selection);
    return level !== undefined && shownLevels(graph, levelPath, expanded).has(level)
      ? levelPath
      : level;
  }
  return isShownNode(graph, levelPath, expanded, selection.id)
    ? levelPath
    : selectionLevel(graph, selection);
}

/**
 * Level a selection gesture shows; undefined keeps the current one. An
 * explicit `level` (outline row, finding) wins, except that a level drawn
 * inside an expanded frame stays as it is: the selection is on screen already.
 * A boundary pin of another level is never drawn as a node of this one.
 */
export function targetLevel(
  graph: SystemGraph,
  levelPath: string,
  expanded: ReadonlySet<string>,
  selection: Selection | null,
  level?: string
): string | undefined {
  if (level === undefined) {
    return selection ? viewLevel(graph, levelPath, expanded, selection) : undefined;
  }
  const drawn =
    selection?.kind !== 'boundary' && shownLevels(graph, levelPath, expanded).has(level);
  return drawn ? levelPath : level;
}

/** The node of `levelPath` that contains `instancePath`: the instance itself, or its outermost block. */
export function levelNodeOf(levelPath: string, instancePath: string): string {
  const prefix = levelPath === '/' ? '/' : `${levelPath}/`;
  const cut = instancePath.indexOf('/', prefix.length);
  return cut < 0 ? instancePath : instancePath.slice(0, cut);
}

/** `expanded` without the paths that are no longer hierarchy instances; the same set when none dropped. */
export function pruneExpanded(
  graph: SystemGraph,
  expanded: ReadonlySet<string>
): ReadonlySet<string> {
  const kept = [...expanded].filter((path) => graph.instances[path]?.kind === 'hier');
  return kept.length === expanded.size ? expanded : new Set(kept);
}
