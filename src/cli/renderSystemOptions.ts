/** Resolves the `--select`, `--hops` and `--highlight` names of `ipcraft render` to diagram nodes. */

import type { SystemGraph } from '../domain/systemGraph';
import { isolateNodes, type SystemLevelRequest } from '../services/render/systemLevelImage';
import { levelNodeOf, shownLevels } from '../webview/systemDiagram/expansion';
import { boundaryId } from '../webview/systemDiagram/model';
import { closestNames } from '../services/render/closestNames';

const PORT_PREFIX = 'port:';

export type ResolvedSelection = Pick<SystemLevelRequest, 'isolate' | 'selectedNodeIds'>;

/**
 * The diagram node for each of `names`: an instance path, an instance name, or `port:<name>` for an
 * external port of `level`. A bare name shared by several candidates must be written as its path.
 */
function resolveNodes(
  graph: SystemGraph,
  level: string,
  names: readonly string[],
  option: string,
  instancePaths: readonly string[]
): string[] {
  const ports = (graph.levels[level]?.boundaryPins ?? []).map((pin) => pin.name);
  const labels = [...instancePaths, ...ports.map((name) => `${PORT_PREFIX}${name}`)];
  return names.map((name) => {
    if (name.startsWith(PORT_PREFIX)) {
      const port = name.slice(PORT_PREFIX.length);
      if (ports.includes(port)) {
        return boundaryId(level, port);
      }
    } else if (instancePaths.includes(name)) {
      return name;
    } else {
      const byName = instancePaths.filter((path) => graph.instances[path]?.name === name);
      if (byName.length > 1) {
        throw new Error(
          `ambiguous name '${name}' in ${option}, use the path: ${byName.join(', ')}`
        );
      }
      if (byName.length === 1) {
        return byName[0];
      }
    }
    const where =
      option === '--select'
        ? `on level '${level}'`
        : `on level '${level}' or inside an expanded block`;
    const close = closestNames(name, labels);
    throw new Error(
      `'${name}' in ${option} is not a block or port (as port:<name>) ${where}.` +
        (close.length > 0 ? ` Closest: ${close.join(', ')}` : ' None is available.')
    );
  });
}

/**
 * Applies the viewer's isolation to `select` at `hops` (clamped to the selection's reach, like the
 * viewer's + button) and resolves `highlight`. A highlighted block may also be inside an expanded
 * frame; with `--select` it must be in the isolated view.
 */
export function resolveSelection(
  graph: SystemGraph,
  level: string,
  options: { select: readonly string[]; hops?: number; highlight: readonly string[] },
  expanded: ReadonlySet<string>
): ResolvedSelection {
  const levelInstances = graph.levels[level].instances;
  const selectedIds = resolveNodes(graph, level, options.select, '--select', levelInstances);
  const selectedNodeIds = new Set(selectedIds);
  const hops = options.hops ?? 1;
  const shownInstances = [...shownLevels(graph, level, expanded)].flatMap(
    (shown) => graph.levels[shown].instances
  );
  const highlighted = resolveNodes(graph, level, options.highlight, '--highlight', shownInstances);
  // The isolated view is computed only to check the highlights against it.
  const isolation =
    selectedIds.length > 0 && highlighted.length > 0
      ? isolateNodes(graph, level, selectedIds, hops)
      : undefined;
  highlighted.forEach((id, index) => {
    if (isolation && !isolation.nodeIds.has(id.includes('::') ? id : levelNodeOf(level, id))) {
      throw new Error(
        `'${options.highlight[index]}' in --highlight is not in the isolated view of --select`
      );
    }
    selectedNodeIds.add(id);
  });
  return {
    ...(selectedIds.length > 0 && { isolate: { nodeIds: selectedIds, hops } }),
    selectedNodeIds: [...selectedNodeIds],
  };
}
