import { useEffect, useMemo, useState } from 'react';
import type { SystemGraph } from '../../../domain/systemGraph';
import {
  buildElkInput,
  toFlowElements,
  type DiagramFlowEdge,
  type DiagramFlowNode,
} from '../layout/elkLayout';
import { runElkLayout } from '../layout/runElkLayout';
import { NO_GHOSTS, withoutGhosts, type Ghosts } from '../layout/unionGraph';
import { isolatedViewKey } from '../layout/viewportPolicy';
import { createTextMeasurer } from '../layout/textMeasure';
import type { IsolatedView } from './useIsolation';

export interface DiagramLayout {
  /** Level this layout belongs to, so a stale result is never taken for the new level. */
  levelPath: string;
  /** Identity of what is shown for the viewport: the level, or one isolation of it. */
  viewKey: string;
  nodes: DiagramFlowNode[];
  edges: DiagramFlowEdge[];
}

/**
 * Lays out one level, with the hierarchy blocks in `expanded` drawn as frames
 * around their inner level; results of superseded requests are ignored. No
 * view toggle (Clocks and resets, review, Removed) is an input: they change what the
 * canvas draws of the layout, never where the blocks sit. A comparison's `graph` is the union
 * with its ghosts (see `unionGraph.ts`); they are left out of the layout returned while
 * `ghostsShown` is false, and the blocks keep the places the union gave them.
 */
export function useElkLayout(
  graph: SystemGraph,
  levelPath: string,
  isolation: IsolatedView | null = null,
  expanded?: ReadonlySet<string>,
  ghosts: Ghosts = NO_GHOSTS,
  ghostsShown = true
): { layout: DiagramLayout | null; error: string | null } {
  const [result, setResult] = useState<{
    layout: DiagramLayout | null;
    /** The ghosts the layout was made with: those of the graph it shows, not of the one asked for since. */
    ghosts: Ghosts;
    error: string | null;
  }>({ layout: null, ghosts: NO_GHOSTS, error: null });

  const measure = useMemo(
    () =>
      createTextMeasurer(
        getComputedStyle(document.body).fontFamily,
        getComputedStyle(document.documentElement)
          .getPropertyValue('--vscode-editor-font-family')
          .trim() || 'monospace'
      ),
    []
  );

  useEffect(() => {
    let stale = false;
    const viewKey = isolation ? isolatedViewKey(levelPath, isolation.token) : levelPath;
    runElkLayout(
      buildElkInput(graph, levelPath, {
        measure,
        ...(isolation && { isolate: isolation }),
        ...(expanded && { expanded }),
      })
    ).then(
      (laidOut) => {
        if (!stale) {
          setResult({
            layout: {
              levelPath,
              viewKey,
              ...toFlowElements(laidOut, graph, levelPath, measure, isolation ?? undefined, ghosts),
            },
            ghosts,
            error: null,
          });
        }
      },
      (error: unknown) => {
        if (!stale) {
          setResult({
            layout: null,
            ghosts: NO_GHOSTS,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    );
    return () => {
      stale = true;
    };
  }, [graph, levelPath, isolation, expanded, ghosts, measure]);

  const { layout, error } = result;
  const drawn = useMemo(
    () => (layout && !ghostsShown ? withoutGhosts(layout, result.ghosts) : layout),
    [layout, result.ghosts, ghostsShown]
  );
  return { layout: drawn, error };
}
