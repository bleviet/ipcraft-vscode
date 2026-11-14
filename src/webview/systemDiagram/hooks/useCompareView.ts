import { useCallback, useEffect, useMemo, useState } from 'react';
import type { SystemGraph } from '../../../domain/systemGraph';
import type { DiagramCompare } from '../../../shared/messages/systemDiagram';
import { changeRows, type ChangeRow } from '../../../services/systemDiagram/diff/changeRows';
import { withoutVersionOnly } from '../../../services/systemDiagram/diff/ignoreVersionOnly';
import type { ChangeContext } from '../changeDecor';
import { buildChangeMarks, markedNodeIds, type ChangeMarks } from '../changeMarks';

/** What the Details panel needs of a comparison, whether or not Marks is on. */
export interface ComparisonDetails {
  marks: ChangeMarks;
  /** The rows of the Changes tab. */
  rows: readonly ChangeRow[];
}

/**
 * The view state of a comparison: the Marks and Version only toggles and the marked nodes of the
 * level on show. Marks is on whenever a comparison starts or its base changes, so the toggle
 * remembers the base it was turned off for; Version only is a preference of the panel and is
 * kept across bases. Nothing here moves a block.
 */
export function useCompareView(
  graph: SystemGraph,
  incoming: DiagramCompare | undefined,
  levelPath: string,
  isolate: (nodeIds: string[]) => void
) {
  const [versionOnly, setVersionOnly] = useState(true);
  const hasVersionOnly = (incoming?.diff.summary.version ?? 0) > 0;
  // Hidden only while there is something to hide: the toolbar then shows the toggle that explains it.
  const hidingVersionOnly = hasVersionOnly && !versionOnly;
  // The comparison the view works on: without the blocks whose only change is the version when asked.
  const shown = useMemo(
    () =>
      incoming && hidingVersionOnly
        ? { ...incoming, diff: withoutVersionOnly(incoming.diff) }
        : incoming,
    [incoming, hidingVersionOnly]
  );
  const { diff, baseLabel } = shown ?? {};
  const marks = useMemo(() => (diff ? buildChangeMarks(diff, graph) : null), [diff, graph]);
  const rows = useMemo(() => (diff ? changeRows(diff, { ignoreVersionOnly: false }) : []), [diff]);
  const [offFor, setOffFor] = useState<string | null>(null);
  useEffect(() => {
    setOffFor(null);
  }, [baseLabel]);
  const marksOn = baseLabel !== undefined && offFor !== baseLabel;
  const setMarksOn = useCallback(
    (on: boolean) => setOffFor(on ? null : (baseLabel ?? null)),
    [baseLabel]
  );

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
    marksOn,
    setMarksOn,
    /** The comparison as the view shows it; the incoming one itself unless version-only changes are hidden. */
    shown,
    versionOnly,
    setVersionOnly,
    /** The comparison has a version-only change, so the toggle means something. */
    hasVersionOnly,
    /** The version-only changes are hidden: the comparison has some and the toggle is off. */
    hidingVersionOnly,
    /** The marks to draw, else null. */
    changes,
    details,
    /** Isolates the marked blocks and ports of the level; absent when it has none or Marks is off. */
    changesOnly: marksOn && markedIds.length > 0 ? changesOnly : undefined,
  };
}
