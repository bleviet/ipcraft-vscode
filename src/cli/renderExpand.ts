/** Resolves the `--expand` names of `ipcraft render` to hierarchy block instance paths. */

import type { SystemGraph } from '../domain/systemGraph';
import { shownLevels } from '../webview/systemDiagram/expansion';
import { closestNames } from '../services/render/closestNames';

/**
 * The instance paths for `--expand` names (a path or a bare name). A block is accepted when it is
 * a hierarchy block of `level` or of a block that is itself expanded, in any order on the line,
 * as the viewer expands recursively; otherwise the error names the closest such blocks.
 */
export function resolveExpanded(
  graph: SystemGraph,
  level: string,
  names: readonly string[]
): string[] {
  const resolved = new Map<string, string>();
  const reachable = () =>
    [...shownLevels(graph, level, new Set(resolved.values()))]
      .flatMap((shown) => graph.levels[shown].instances)
      .filter((instancePath) => graph.instances[instancePath]?.kind === 'hier');
  let progress = true;
  while (progress) {
    progress = false;
    const candidates = reachable();
    for (const name of names) {
      const byName = candidates.filter(
        (instancePath) => graph.instances[instancePath].name === name
      );
      if (!candidates.includes(name) && byName.length > 1) {
        throw new Error(`ambiguous name '${name}', use the path: ${byName.join(', ')}`);
      }
      const found = candidates.includes(name) ? name : byName[0];
      if (found && !resolved.has(name)) {
        resolved.set(name, found);
        progress = true;
      }
    }
  }
  const unknown = names.find((name) => !resolved.has(name));
  if (unknown !== undefined) {
    const close = closestNames(unknown, reachable());
    throw new Error(
      `'${unknown}' is not a hierarchy block on level '${level}' or inside an expanded block.` +
        (close.length > 0 ? ` Closest: ${close.join(', ')}` : ' None is available.')
    );
  }
  return names.map((name) => resolved.get(name) as string);
}
