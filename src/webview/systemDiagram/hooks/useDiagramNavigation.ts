import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SystemGraph } from '../../../domain/systemGraph';
import {
  isShownNode,
  isShownSelection,
  levelNodeOf,
  pruneExpanded,
  targetLevel,
} from '../expansion';
import { NO_GHOSTS, type Ghosts } from '../layout/unionGraph';
import {
  nodeSelection,
  reconcileNavigation,
  sameSelection,
  type RevealRequest,
  type Selection,
} from '../model';

/**
 * Current level, expanded hierarchy blocks and selection of the diagram, and
 * the gestures that change them. `selection` is the primary item (it drives
 * Details); `selectedItems` are all selected items of the view (Cmd/Ctrl+Click
 * adds to them). The expanded blocks are a set of instance paths that survives
 * navigation: entering a block shows its own expanded children expanded. A ghost block (what
 * only the base has, `ghosts` of a comparison) has no level of its own: it is neither entered
 * nor expanded.
 */
export function useDiagramNavigation(graph: SystemGraph, ghosts: Ghosts = NO_GHOSTS) {
  const [levelPath, setLevelPath] = useState('/');
  const [selection, setSelection] = useState<Selection | null>(null);
  const [items, setItems] = useState<Selection[]>([]);
  const [revealRequest, setRevealRequest] = useState<RevealRequest | null>(null);
  const [expandedState, setExpandedState] = useState<ReadonlySet<string>>(() => new Set());
  const expanded = useMemo(() => pruneExpanded(graph, expandedState), [graph, expandedState]);
  const lastToken = useRef(0);

  const select = useCallback(
    (next: Selection | null, level?: string) => {
      setSelection(next);
      setItems(next ? [next] : []);
      setRevealRequest(null);
      const target = targetLevel(graph, levelPath, expanded, next, level);
      if (target !== undefined) {
        setLevelPath(target);
      }
    },
    [graph, levelPath, expanded]
  );
  /**
   * Selection made outside the canvas: also centres the selected node. A net
   * has no node of its own; `revealNode` names the node to centre for it (the
   * outermost block containing it when that node is not drawn on the level).
   */
  const selectAndReveal = useCallback(
    (next: Selection | null, level?: string, readable?: true, revealNode?: string) => {
      select(next, level);
      const target = targetLevel(graph, levelPath, expanded, next, level);
      if (!next || target === undefined) {
        return;
      }
      let shown: Selection | undefined = next.kind === 'net' ? undefined : next;
      if (next.kind === 'net' && revealNode !== undefined) {
        const drawn =
          isShownNode(graph, target, expanded, revealNode) || !graph.instances[revealNode];
        shown = nodeSelection(drawn ? revealNode : levelNodeOf(target, revealNode));
      }
      if (shown) {
        lastToken.current += 1;
        setRevealRequest({
          token: lastToken.current,
          selection: shown,
          levelPath: target,
          ...(readable && { readable }),
        });
      }
    },
    [graph, levelPath, expanded, select]
  );
  /** Search step: select the instance, switch to its level, and centre it at a readable zoom. */
  const revealMatch = useCallback(
    (instancePath: string) =>
      selectAndReveal({ kind: 'instance', id: instancePath }, undefined, true),
    [selectAndReveal]
  );
  const navigate = useCallback((path: string) => {
    setLevelPath(path);
    setSelection(null);
    setItems([]);
    setRevealRequest(null);
  }, []);
  const enterHierarchy = useCallback(
    (instancePath: string) => {
      if (graph.instances[instancePath]?.kind === 'hier' && !ghosts.instances.has(instancePath)) {
        navigate(instancePath);
      }
    },
    [graph, ghosts, navigate]
  );
  /** Expands or collapses a hierarchy block in place; the level, selection and viewport stay. */
  const toggleExpanded = useCallback(
    (instancePath: string) => {
      if (graph.instances[instancePath]?.kind !== 'hier' || ghosts.instances.has(instancePath)) {
        return;
      }
      setExpandedState((current) => {
        const next = new Set(current);
        if (!next.delete(instancePath)) {
          next.add(instancePath);
        }
        return next;
      });
    },
    [graph, ghosts]
  );
  const selectInstance = useCallback(
    (instancePath: string) => selectAndReveal({ kind: 'instance', id: instancePath }),
    [selectAndReveal]
  );

  // Show the reconciled values at once (no frame with a vanished level) and
  // bring the state in line with them.
  const shown = useMemo(
    () => reconcileNavigation(graph, levelPath, selection),
    [graph, levelPath, selection]
  );
  const selectedItems = useMemo<readonly Selection[]>(() => {
    const { selection: current, levelPath: level } = shown;
    if (!current) {
      return [];
    }
    const kept = items.filter((item) => isShownSelection(graph, level, expanded, item));
    return kept.some((item) => sameSelection(item, current)) ? kept : [current];
  }, [graph, expanded, shown, items]);
  const selectedNodeIds = useMemo(
    () => selectedItems.filter((item) => item.kind !== 'net').map((item) => item.id),
    [selectedItems]
  );
  const selectedNetIds = useMemo<ReadonlySet<string>>(
    () => new Set(selectedItems.filter((item) => item.kind === 'net').map((item) => item.id)),
    [selectedItems]
  );
  /** Cmd/Ctrl+Click: adds the item to the selection, or removes it when already selected. */
  const toggleSelection = useCallback(
    (item: Selection) => {
      if (!selectedItems.some((current) => sameSelection(current, item))) {
        setSelection(item);
        setItems([...selectedItems, item]);
      } else {
        const rest = selectedItems.filter((current) => !sameSelection(current, item));
        setSelection(rest[rest.length - 1] ?? null);
        setItems(rest);
      }
      setRevealRequest(null);
    },
    [selectedItems]
  );

  useEffect(() => {
    if (shown.levelPath !== levelPath) {
      navigate(shown.levelPath);
    } else if (shown.selection !== selection) {
      setSelection(shown.selection);
      setRevealRequest(null);
    }
  }, [shown, levelPath, selection, navigate]);

  return {
    levelPath: shown.levelPath,
    expanded,
    selection: shown.selection,
    selectedItems,
    selectedNodeIds,
    selectedNetIds,
    revealRequest,
    select,
    toggleSelection,
    toggleNode: toggleSelection,
    selectAndReveal,
    revealMatch,
    navigate,
    enterHierarchy,
    toggleExpanded,
    selectInstance,
  };
}
