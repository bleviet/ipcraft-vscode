import { useCallback, useEffect, useMemo, useState } from 'react';
import type { SystemGraph } from '../../../domain/systemGraph';
import type { Selection } from '../model';
import { matchCounter, searchMatches, stepMatch } from '../search';

/** The node to pulse; a new `token` restarts the pulse even on the same node. */
export interface SearchFlash {
  id: string;
  token: number;
}

/** Steps through the search matches of every level and reports where it is. */
export function useSearchStepper(
  graph: SystemGraph,
  query: string,
  selection: Selection | null,
  revealMatch: (instancePath: string) => void
) {
  const matches = useMemo(() => searchMatches(graph, query), [graph, query]);
  const [flash, setFlash] = useState<SearchFlash | null>(null);
  const blank = query.trim() === '';
  useEffect(() => {
    if (blank) {
      setFlash(null);
    }
  }, [blank]);
  const selectedId = selection?.kind === 'instance' ? selection.id : undefined;

  const step = useCallback(
    (direction: 1 | -1) => {
      const next = stepMatch(matches, selectedId, direction);
      if (next === undefined) {
        return;
      }
      revealMatch(next);
      setFlash((previous) => ({ id: next, token: (previous?.token ?? 0) + 1 }));
    },
    [matches, selectedId, revealMatch]
  );

  /** Ends the pulse unless a later step already replaced it. */
  const clearFlash = useCallback(
    (token: number) => setFlash((current) => (current?.token === token ? null : current)),
    []
  );

  return { counter: matchCounter(matches, selectedId), step, flash, clearFlash };
}
