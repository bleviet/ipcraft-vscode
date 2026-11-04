import { useEffect, useState } from 'react';
import type { SystemGraph } from '../../../domain/systemGraph';
import {
  buildElkInput,
  toFlowElements,
  type DiagramFlowEdge,
  type DiagramFlowNode,
} from '../layout/elkLayout';
import { runElkLayout } from '../layout/runElkLayout';

export interface DiagramLayout {
  /** Level this layout belongs to, so a stale result is never taken for the new level. */
  levelPath: string;
  nodes: DiagramFlowNode[];
  edges: DiagramFlowEdge[];
}

/** Lays out one level; results of superseded requests are ignored. */
export function useElkLayout(
  graph: SystemGraph,
  levelPath: string,
  showClockReset: boolean
): { layout: DiagramLayout | null; error: string | null } {
  const [result, setResult] = useState<{
    layout: DiagramLayout | null;
    error: string | null;
  }>({ layout: null, error: null });

  useEffect(() => {
    let stale = false;
    runElkLayout(buildElkInput(graph, levelPath, { showClockReset })).then(
      (laidOut) => {
        if (!stale) {
          setResult({
            layout: { levelPath, ...toFlowElements(laidOut, graph, levelPath) },
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
  }, [graph, levelPath, showClockReset]);

  return result;
}
