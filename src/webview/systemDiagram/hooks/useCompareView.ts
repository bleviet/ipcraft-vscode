import { useCallback, useMemo } from 'react';
import type { SystemGraph } from '../../../domain/systemGraph';
import { changeRows, type ChangeRow } from '../../../services/systemDiagram/diff/changeRows';
import type { ChangeContext } from '../changeDecor';
import { buildChangeMarks, markedNodeIds, type ChangeMarks } from '../changeMarks';
import type { Ghosts } from '../layout/unionGraph';
import type { CompareToggles } from './useCompareToggles';

/** What the Details panel needs of a comparison, whether or not Marks is on. */
export interface ComparisonDetails {
  marks: ChangeMarks;
  /** The rows of the Changes tab. */
  rows: readonly ChangeRow[];
}

/**
 * The view of a comparison: the marks and the rows of its changes, the marks to draw (only while
 * Marks is on) and the marked nodes of the level on show. `graph` is the open design; `ghosts`
 * are the removed things that are shown, which the marks carry as removed. The toggles are
 * those of `useCompareToggles`. Nothing here moves a block.
 */
export function useCompareView(
  graph: SystemGraph,
  toggles: CompareToggles,
  levelPath: string,
  isolate: (nodeIds: string[]) => void,
  ghosts?: Ghosts
) {
  const { shown, marksOn } = toggles;
  const diff = shown?.diff;
  const marks = useMemo(
    () => (diff ? buildChangeMarks(diff, graph, ghosts) : null),
    [diff, graph, ghosts]
  );
  const rows = useMemo(() => (diff ? changeRows(diff, { ignoreVersionOnly: false }) : []), [diff]);

  const changes = useMemo<ChangeContext | null>(
    () => (marks && marksOn ? { marks, graph, levelPath } : null),
    [marks, marksOn, graph, levelPath]
  );
  const details = useMemo<ComparisonDetails | undefined>(
    () => (marks ? { marks, rows } : undefined),
    [marks, rows]
  );
  const markedIds = useMemo(
    () => (marks ? markedNodeIds(marks, graph, levelPath) : []),
    [marks, graph, levelPath]
  );
  const changesOnly = useCallback(() => isolate(markedIds), [isolate, markedIds]);
  return {
    ...toggles,
    /** The marks to draw, else null. */
    changes,
    details,
    /** Isolates the marked blocks and ports of the level; absent when it has none or Marks is off. */
    changesOnly: marksOn && markedIds.length > 0 ? changesOnly : undefined,
  };
}
