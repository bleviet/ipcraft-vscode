import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SystemGraph } from '../../../domain/systemGraph';
import { levelNodeOf, targetLevel } from '../expansion';
import { hopDistances, isolationSubset, maxRadius } from '../isolation';
import { isLevelNode, type Selection } from '../model';

/** The isolated view being shown; a new `token` marks a new isolation or a radius change (it refits the view). */
export interface IsolatedView {
  token: number;
  nodeIds: ReadonlySet<string>;
  edgeIds: ReadonlySet<string>;
  /** Nodes isolated on purpose, as opposed to the neighbours kept for their connections. */
  selectedCount: number;
  /** The ids of those nodes. */
  seedIds: readonly string[];
  /** Hops from the selection that are shown. */
  hops: number;
  /** Largest radius worth showing: the furthest hop reachable, at least 1. */
  maxRadius: number;
  /** Nodes of the level that can be isolated: its instances and boundary pins. */
  levelNodeCount: number;
}

interface IsolationState {
  levelPath: string;
  nodeIds: string[];
  token: number;
  hops: number;
}

interface IsolationNavigation {
  levelPath: string;
  /** Hierarchy blocks drawn expanded; an instance inside one is shown with its outermost block. */
  expanded: ReadonlySet<string>;
  selectAndReveal: (
    next: Selection | null,
    level?: string,
    readable?: true,
    revealNode?: string
  ) => void;
  revealMatch: (instancePath: string) => void;
  selectInstance: (instancePath: string) => void;
}

/**
 * Isolated view of one level. It ends on Show All, on leaving the level, when
 * its blocks vanish from the graph, and when a reveal targets a node it hides
 * (the reveal then proceeds on the full level). The reveal gestures returned
 * wrap those of the navigation for that last rule.
 */
export function useIsolation(graph: SystemGraph, nav: IsolationNavigation) {
  const { levelPath, expanded } = nav;
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
  const distances = useMemo(
    () => (ids.length === 0 ? null : hopDistances(graph, levelPath, ids)),
    [graph, levelPath, ids]
  );
  const isolation = useMemo<IsolatedView | null>(() => {
    if (!distances) {
      return null;
    }
    const level = graph.levels[levelPath];
    const radius = maxRadius(distances);
    // The graph can change under the isolation: never show a radius past what is reachable.
    const hops = Math.min(state?.hops ?? 1, radius);
    return {
      token,
      selectedCount: ids.length,
      seedIds: ids,
      hops,
      maxRadius: radius,
      levelNodeCount: (level?.instances.length ?? 0) + (level?.boundaryPins.length ?? 0),
      ...isolationSubset(graph, levelPath, ids, hops, distances),
    };
  }, [graph, levelPath, ids, token, state?.hops, distances]);
  useEffect(() => {
    if (state && !isolation) {
      setState(null);
    }
  }, [state, isolation]);

  const isolate = useCallback(
    (nodeIds: string[]) => {
      lastToken.current += 1;
      setState({ levelPath, nodeIds, token: lastToken.current, hops: 1 });
    },
    [levelPath]
  );
  const showAll = useCallback(() => setState(null), []);
  /** Clamps to [1, maxRadius]; a new radius refits the view like a new isolation. */
  const setHops = useCallback(
    (next: number) => {
      if (!isolation) {
        return;
      }
      const clamped = Math.min(Math.max(1, next), isolation.maxRadius);
      if (clamped === isolation.hops) {
        return;
      }
      lastToken.current += 1;
      setState((current) =>
        current ? { ...current, hops: clamped, token: lastToken.current } : current
      );
    },
    [isolation]
  );
  /** Only nodes of the level on show can be isolated, not those inside an expanded frame. */
  const canIsolate = useCallback(
    (nodeIds: string[]) => nodeIds.every((id) => isLevelNode(graph, levelPath, id)),
    [graph, levelPath]
  );

  const endIfHidden = useCallback(
    (next: Selection | null, level?: string) => {
      if (!isolation || !next || next.kind === 'net') {
        return;
      }
      const shownHere = targetLevel(graph, levelPath, expanded, next, level) === levelPath;
      const nodeId = next.kind === 'instance' ? levelNodeOf(levelPath, next.id) : next.id;
      if (shownHere && !isolation.nodeIds.has(nodeId)) {
        setState(null);
      }
    },
    [graph, isolation, levelPath, expanded]
  );
  const { selectAndReveal, revealMatch, selectInstance } = nav;
  const selectAndRevealShown = useCallback(
    (next: Selection | null, level?: string, readable?: true, revealNode?: string) => {
      endIfHidden(next, level);
      selectAndReveal(next, level, readable, revealNode);
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
    canIsolate,
    showAll,
    setHops,
    selectAndReveal: selectAndRevealShown,
    revealMatch: revealMatchShown,
    selectInstance: selectInstanceShown,
  };
}
