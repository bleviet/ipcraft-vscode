import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SystemGraph } from '../../../domain/systemGraph';
import { isolationSubset } from '../isolation';
import { isLevelNode, selectionLevel, type Selection } from '../model';

/** The isolated view being shown; a new `token` marks a new isolation (it refits the view). */
export interface IsolatedView {
  token: number;
  nodeIds: ReadonlySet<string>;
  edgeIds: ReadonlySet<string>;
  /** Nodes isolated on purpose, as opposed to the neighbours kept for their connections. */
  selectedCount: number;
}

interface IsolationState {
  levelPath: string;
  nodeIds: string[];
  token: number;
}

interface IsolationNavigation {
  levelPath: string;
  selectAndReveal: (next: Selection | null, level?: string, readable?: true) => void;
  revealMatch: (instancePath: string) => void;
  selectInstance: (instancePath: string) => void;
}

/**
 * Isolated view of one level. It ends on Show All, on leaving the level, when
 * its blocks vanish from the graph, and when a reveal targets a node it hides
 * (the reveal then proceeds on the full level). The reveal gestures returned
 * wrap those of the navigation for that last rule.
 */
export function useIsolation(
  graph: SystemGraph,
  nav: IsolationNavigation,
  showClockReset: boolean
) {
  const { levelPath } = nav;
  const [state, setState] = useState<IsolationState | null>(null);
  const lastToken = useRef(0);

  const ids = useMemo(
    () =>
      state?.levelPath === levelPath
        ? state.nodeIds.filter((id) => isLevelNode(graph, levelPath, id))
        : [],
    [graph, levelPath, state]
  );
  const token = state?.token ?? 0;
  const isolation = useMemo<IsolatedView | null>(
    () =>
      ids.length === 0
        ? null
        : {
            token,
            selectedCount: ids.length,
            ...isolationSubset(graph, levelPath, ids, showClockReset),
          },
    [graph, levelPath, ids, token, showClockReset]
  );
  useEffect(() => {
    if (state && !isolation) {
      setState(null);
    }
  }, [state, isolation]);

  const isolate = useCallback(
    (nodeIds: string[]) => {
      lastToken.current += 1;
      setState({ levelPath, nodeIds, token: lastToken.current });
    },
    [levelPath]
  );
  const showAll = useCallback(() => setState(null), []);

  const endIfHidden = useCallback(
    (next: Selection | null, level?: string) => {
      if (!isolation || !next || next.kind === 'net') {
        return;
      }
      const target = level ?? selectionLevel(graph, next);
      if (target === levelPath && !isolation.nodeIds.has(next.id)) {
        setState(null);
      }
    },
    [graph, isolation, levelPath]
  );
  const { selectAndReveal, revealMatch, selectInstance } = nav;
  const selectAndRevealShown = useCallback(
    (next: Selection | null, level?: string, readable?: true) => {
      endIfHidden(next, level);
      selectAndReveal(next, level, readable);
    },
    [endIfHidden, selectAndReveal]
  );
  const revealMatchShown = useCallback(
    (instancePath: string) => {
      endIfHidden({ kind: 'instance', id: instancePath });
      revealMatch(instancePath);
    },
    [endIfHidden, revealMatch]
  );
  const selectInstanceShown = useCallback(
    (instancePath: string) => {
      endIfHidden({ kind: 'instance', id: instancePath });
      selectInstance(instancePath);
    },
    [endIfHidden, selectInstance]
  );

  return {
    isolation,
    isolate,
    showAll,
    selectAndReveal: selectAndRevealShown,
    revealMatch: revealMatchShown,
    selectInstance: selectInstanceShown,
  };
}
