import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SystemGraph } from '../../../domain/systemGraph';
import { levelNodeOf, targetLevel } from '../expansion';
import { isolationSubset, pairSubset, type IsolationHops } from '../isolation';
import type { IsolationSubset } from '../layout/diagramTypes';
import { isLevelNode, type Selection } from '../model';
import { computePathTrace, traceSubset, type PathTrace } from '../pathTrace';

/** The isolated view being shown; a new `token` marks a new isolation (it refits the view). */
export interface IsolatedView extends IsolationSubset {
  token: number;
  /** Nodes isolated on purpose, as opposed to the neighbours kept for their connections. */
  selectedCount: number;
  /** Nodes on the level, shown or not. */
  levelNodeCount: number;
  /** Present on a node isolation: how many hops around the selected nodes are shown. */
  hops?: IsolationHops;
  /** Present on a traced path: the path between `from` and `to`. */
  trace?: PathTrace & { from: string; to: string };
  /** Present on a pair isolation: the two nodes and the edges between them. */
  pair?: { a: string; b: string };
}

type IsolationState =
  | { kind: 'nodes'; levelPath: string; nodeIds: string[]; hops: IsolationHops; token: number }
  | { kind: 'trace'; levelPath: string; from: string; to: string; token: number }
  | { kind: 'pair'; levelPath: string; a: string; b: string; token: number };

/** The isolated view of a state on `levelPath` with the graph as it is now; null once it has nothing to show. */
function viewOf(
  graph: SystemGraph,
  levelPath: string,
  state: IsolationState | null
): IsolatedView | null {
  if (state?.levelPath !== levelPath) {
    return null;
  }
  const { token } = state;
  const level = graph.levels[levelPath];
  const levelNodeCount = (level?.instances.length ?? 0) + (level?.boundaryPins.length ?? 0);
  if (state.kind === 'trace') {
    const trace = computePathTrace(graph, levelPath, state.from, state.to);
    return trace
      ? {
          token,
          selectedCount: 2,
          levelNodeCount,
          trace: { ...trace, from: state.from, to: state.to },
          ...traceSubset(graph, levelPath, trace),
        }
      : null;
  }
  if (state.kind === 'pair') {
    return isLevelNode(graph, levelPath, state.a) && isLevelNode(graph, levelPath, state.b)
      ? {
          token,
          selectedCount: state.a === state.b ? 1 : 2,
          levelNodeCount,
          pair: { a: state.a, b: state.b },
          ...pairSubset(graph, levelPath, state.a, state.b),
        }
      : null;
  }
  const ids = state.nodeIds.filter((id) => isLevelNode(graph, levelPath, id));
  return ids.length === 0
    ? null
    : {
        token,
        selectedCount: ids.length,
        levelNodeCount,
        hops: state.hops,
        ...isolationSubset(graph, levelPath, ids, state.hops),
      };
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

  const isolation = useMemo(() => viewOf(graph, levelPath, state), [graph, levelPath, state]);
  useEffect(() => {
    if (state && !isolation) {
      setState(null);
    }
  }, [state, isolation]);

  const isolate = useCallback(
    (nodeIds: string[]) => {
      lastToken.current += 1;
      setState({ kind: 'nodes', levelPath, nodeIds, hops: 1, token: lastToken.current });
    },
    [levelPath]
  );
  /** Changes the hop radius of a node isolation; a new view, so it refits. */
  const setHops = useCallback((hops: IsolationHops) => {
    lastToken.current += 1;
    setState((current) =>
      current?.kind === 'nodes' && current.hops !== hops
        ? { ...current, hops, token: lastToken.current }
        : current
    );
  }, []);
  /** Isolates the shortest path between two nodes; without one the view stays as it was. */
  const trace = useCallback(
    (from: string, to: string): boolean => {
      if (!computePathTrace(graph, levelPath, from, to)) {
        return false;
      }
      lastToken.current += 1;
      setState({ kind: 'trace', levelPath, from, to, token: lastToken.current });
      return true;
    },
    [graph, levelPath]
  );
  /** Isolates exactly two nodes and the edges between them (the matrix cell, a bundle). */
  const isolatePair = useCallback(
    (a: string, b: string) => {
      lastToken.current += 1;
      setState({ kind: 'pair', levelPath, a, b, token: lastToken.current });
    },
    [levelPath]
  );
  const showAll = useCallback(() => setState(null), []);
  /** Ends a traced path, leaving a node isolation alone. */
  const endTrace = useCallback(
    () => setState((current) => (current?.kind === 'trace' ? null : current)),
    []
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
    isolatePair,
    setHops,
    trace,
    endTrace,
    canIsolate,
    showAll,
    selectAndReveal: selectAndRevealShown,
    revealMatch: revealMatchShown,
    selectInstance: selectInstanceShown,
  };
}
