import { useCallback, useEffect, useMemo, useState } from 'react';
import type { SystemGraph } from '../../../domain/systemGraph';
import { instanceTypeLabel, type Selection } from '../model';
import {
  groupMatches,
  matchCounter,
  resultsSummary,
  searchMatches,
  stepMatch,
  type ResultRow,
} from '../search';
import type { TextMatcher } from '../searchMatcher';

/** The node to pulse; a new `token` restarts the pulse even on the same node. */
export interface SearchFlash {
  id: string;
  token: number;
}

/** Steps through the search matches of every level and reports where it is. */
export function useSearchStepper(
  graph: SystemGraph,
  matcher: TextMatcher | null,
  selection: Selection | null,
  revealMatch: (instancePath: string) => void
) {
  const matches = useMemo(() => searchMatches(graph, matcher), [graph, matcher]);
  const [flash, setFlash] = useState<SearchFlash | null>(null);
  const blank = matcher === null;
  useEffect(() => {
    if (blank) {
      setFlash(null);
    }
  }, [blank]);
  const groups = useMemo(() => groupMatches(graph, matches), [graph, matches]);
  // The visible order of the results list is the one order the steps and the counter follow.
  const ordered = useMemo(() => groups.flatMap((group) => group.paths), [groups]);
  const selectedId = selection?.kind === 'instance' ? selection.id : undefined;

  /** Reveals the match `path` and pulses it. */
  const jumpTo = useCallback(
    (path: string) => {
      revealMatch(path);
      setFlash((previous) => ({ id: path, token: (previous?.token ?? 0) + 1 }));
    },
    [revealMatch]
  );

  const step = useCallback(
    (direction: 1 | -1) => {
      const next = stepMatch(ordered, selectedId, direction);
      if (next !== undefined) {
        jumpTo(next);
      }
    },
    [ordered, selectedId, jumpTo]
  );

  /** Ends the pulse unless a later step already replaced it. */
  const clearFlash = useCallback(
    (token: number) => setFlash((current) => (current?.token === token ? null : current)),
    []
  );

  return {
    matches,
    counter: matchCounter(ordered, selectedId),
    /** What the results dropdown lists; `currentId` is the selected instance when it is a match. */
    results: {
      groups,
      summary: resultsSummary(groups),
      currentId: selectedId !== undefined && ordered.includes(selectedId) ? selectedId : undefined,
      rowOf: (path: string): ResultRow => {
        const instance = graph.instances[path];
        return { name: instance?.name ?? path, type: instance && instanceTypeLabel(instance) };
      },
    },
    step,
    jumpTo,
    flash,
    clearFlash,
  };
}
