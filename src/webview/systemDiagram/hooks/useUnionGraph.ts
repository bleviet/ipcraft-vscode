import { useMemo } from 'react';
import type { SystemGraph } from '../../../domain/systemGraph';
import type { DiagramCompare } from '../../../shared/messages/systemDiagram';
import { NO_GHOSTS, withUnion } from '../layout/unionGraph';
import { useCompareToggles } from './useCompareToggles';

/**
 * The toggles of a comparison and its graphs with ghosts (see `layout/unionGraph.ts`): the union
 * is what the layout is made from whenever the comparison has ghosts, so no toggle moves a block;
 * the user selects, searches and isolates in the union only while the ghosts are shown, else in
 * the open design (`graph`). `ghosts` are those of the union, `shown` those that are drawn.
 */
export function useUnionGraph(graph: SystemGraph, compare: DiagramCompare | undefined) {
  const toggles = useCompareToggles(compare);
  const merged = useMemo(() => withUnion(graph, compare?.union), [graph, compare?.union]);
  const { ghostsShown } = toggles;
  return {
    toggles,
    layoutGraph: merged.graph,
    viewGraph: ghostsShown ? merged.graph : graph,
    ghosts: merged.ghosts,
    shown: ghostsShown ? merged.ghosts : NO_GHOSTS,
  };
}
