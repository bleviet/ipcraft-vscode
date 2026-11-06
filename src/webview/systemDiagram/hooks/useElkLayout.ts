import { useEffect, useMemo, useState } from 'react';
import type { SystemGraph } from '../../../domain/systemGraph';
import {
  buildElkInput,
  toFlowElements,
  type DiagramFlowEdge,
  type DiagramFlowNode,
} from '../layout/elkLayout';
import { runElkLayout } from '../layout/runElkLayout';
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
 * around their inner level; results of superseded requests are ignored.
 */
export function useElkLayout(
  graph: SystemGraph,
  levelPath: string,
  showClockReset: boolean,
  isolation: IsolatedView | null = null,
  expanded?: ReadonlySet<string>
): { layout: DiagramLayout | null; error: string | null } {
  const [result, setResult] = useState<{
    layout: DiagramLayout | null;
    error: string | null;
  }>({ layout: null, error: null });

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
        showClockReset,
        measure,
        ...(isolation && { isolate: isolation }),
        ...(expanded && { expanded }),
      })
    ).then(
      (laidOut) => {
        if (!stale) {
          setResult({
            layout: { levelPath, viewKey, ...toFlowElements(laidOut, graph, levelPath, measure) },
            error: null,
          });
        }
      },
      (error: unknown) => {
        if (!stale) {
          setResult({
            layout: null,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    );
    return () => {
      stale = true;
    };
  }, [graph, levelPath, showClockReset, isolation, expanded, measure]);

  return result;
}
