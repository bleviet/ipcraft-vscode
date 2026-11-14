import { useCallback, useEffect, useMemo, useState } from 'react';
import type { DiagramCompare } from '../../../shared/messages/systemDiagram';
import { withoutVersionOnly } from '../../../services/systemDiagram/diff/ignoreVersionOnly';

/**
 * A toggle that is on whenever a comparison starts or its base changes: it remembers the base it
 * was turned off for, so the same base compared again (an edit) keeps it off. Off without a comparison.
 */
function useBaseToggle(baseLabel: string | undefined): [boolean, (on: boolean) => void] {
  const [offFor, setOffFor] = useState<string | null>(null);
  useEffect(() => {
    setOffFor(null);
  }, [baseLabel]);
  const setOn = useCallback(
    (on: boolean) => setOffFor(on ? null : (baseLabel ?? null)),
    [baseLabel]
  );
  return [baseLabel !== undefined && offFor !== baseLabel, setOn];
}

/**
 * The toggles of a comparison: Marks and Removed (on whenever a comparison starts or its base
 * changes) and Version only (a preference of the panel, kept across bases). They only change
 * what is drawn: no block moves. They are read before the navigation state is, because whether
 * ghosts are shown decides which graph the user can select in.
 */
export function useCompareToggles(incoming: DiagramCompare | undefined) {
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
  const baseLabel = shown?.baseLabel;
  const [marksOn, setMarksOn] = useBaseToggle(baseLabel);
  const [removedOn, setRemovedOn] = useBaseToggle(baseLabel);
  // The base has something the current side lacks, so the Removed toggle means something.
  const hasRemoved = incoming?.union !== undefined;
  return {
    shown,
    marksOn,
    setMarksOn,
    removedOn,
    setRemovedOn,
    hasRemoved,
    /** The ghosts of what only the base has are drawn: Marks, the master switch, and Removed are on. */
    ghostsShown: marksOn && removedOn && hasRemoved,
    versionOnly,
    setVersionOnly,
    /** The comparison has a version-only change, so the toggle means something. */
    hasVersionOnly,
    /** The version-only changes are hidden: the comparison has some and the toggle is off. */
    hidingVersionOnly,
  };
}

export type CompareToggles = ReturnType<typeof useCompareToggles>;
