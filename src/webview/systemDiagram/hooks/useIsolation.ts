import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SystemGraph } from '../../../domain/systemGraph';
import { levelNodeOf, targetLevel } from '../expansion';
import { hopDistances, isolationSubset, maxRadius } from '../isolation';
import { isGhostNode, NO_GHOSTS, openCellCount, type Ghosts } from '../layout/unionGraph';
import { boundaryId, isLevelNode, type Selection } from '../model';

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
  /** Nodes of the level that can be isolated: its instances and boundary pins, not counting ghosts. */
  levelNodeCount: number;
  /** How many of `nodeIds` are nodes of the design as opened, that is, not ghosts. */
  openNodeCount: number;
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
 * wrap those of the navigation for that last rule. A comparison's `graph` is the union with its
 * ghosts whatever the toggles, so the isolated layout never depends on them; `ghosts` only keep
 * the counts to the design as opened (plus a ghost you isolated) and drop a hidden ghost from the
 * seeds: the one case where hiding ghosts changes an isolation.
 */
export function useIsolation(
  graph: SystemGraph,
  nav: IsolationNavigation,
  ghosts: Ghosts = NO_GHOSTS,
  ghostsShown = true
) {
  const { levelPath, expanded } = nav;
  const [state, setState] = useState<IsolationState | null>(null);
  const lastToken = useRef(0);

  // The seeds still on show. The same array while their contents are the same, so a toggle that
  // changes no seed (hiding ghosts when none is isolated) does not make a new isolation and a new layout.
  const previousIds = useRef<string[]>([]);
  const ids = useMemo(() => {
    const next =
      state?.levelPath === levelPath
        ? state.nodeIds.filter(
            (id) => isLevelNode(graph, levelPath, id) && (ghostsShown || !isGhostNode(ghosts, id))
          )
        : [];
    const same =
      next.length === previousIds.current.length &&
      next.every((id, index) => id === previousIds.current[index]);
    previousIds.current = same ? previousIds.current : next;
    return previousIds.current;
  }, [graph, levelPath, state, ghosts, ghostsShown]);
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
    const subset = isolationSubset(graph, levelPath, ids, hops, distances);
    return {
      token,
      // A ghost you isolated is selected, and counted, while its ghost is shown.
      selectedCount: ids.length,
      seedIds: ids,
      hops,
      maxRadius: radius,
      levelNodeCount:
        openCellCount(graph, levelPath, ghosts.instances) +
        (level?.boundaryPins.filter((pin) => !isGhostNode(ghosts, boundaryId(levelPath, pin.name)))
          .length ?? 0),
      ...subset,
      openNodeCount: [...subset.nodeIds].filter(
        (id) => ids.includes(id) || !isGhostNode(ghosts, id)
      ).length,
    };
  }, [graph, levelPath, ids, token, state?.hops, distances, ghosts]);
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
