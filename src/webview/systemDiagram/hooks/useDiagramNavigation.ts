import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SystemGraph } from '../../../domain/systemGraph';
import {
  isShownNode,
  isShownSelection,
  levelNodeOf,
  pruneExpanded,
  targetLevel,
} from '../expansion';
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
 * navigation: entering a block shows its own expanded children expanded.
 */
export function useDiagramNavigation(graph: SystemGraph) {
  const [levelPath, setLevelPath] = useState('/');
  const [selection, setSelection] = useState<Selection | null>(null);
  const [items, setItems] = useState<Selection[]>([]);
  // The bundle whose click selected `items`; any other selection gesture clears it.
  const [activeBundleKey, setActiveBundleKey] = useState<string | null>(null);
  const [revealRequest, setRevealRequest] = useState<RevealRequest | null>(null);
  const [expandedState, setExpandedState] = useState<ReadonlySet<string>>(() => new Set());
  const expanded = useMemo(() => pruneExpanded(graph, expandedState), [graph, expandedState]);
  const lastToken = useRef(0);

  const select = useCallback(
    (next: Selection | null, level?: string) => {
      setSelection(next);
      setItems(next ? [next] : []);
      setActiveBundleKey(null);
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
    setActiveBundleKey(null);
    setRevealRequest(null);
  }, []);
  const enterHierarchy = useCallback(
    (instancePath: string) => {
      if (graph.instances[instancePath]?.kind === 'hier') {
        navigate(instancePath);
      }
    },
    [graph, navigate]
  );
  /** Expands or collapses a hierarchy block in place; the level, selection and viewport stay. */
  const toggleExpanded = useCallback(
    (instancePath: string) => {
      if (graph.instances[instancePath]?.kind !== 'hier') {
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
    [graph]
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
        setActiveBundleKey(null);
      } else {
        const rest = selectedItems.filter((current) => !sameSelection(current, item));
        setSelection(rest[rest.length - 1] ?? null);
        setItems(rest);
        setActiveBundleKey(null);
      }
      setRevealRequest(null);
    },
    [selectedItems]
  );
  /** Click on a bundle: selects all its items at once, the last one primary, and records the bundle. */
  const selectItems = useCallback((next: readonly Selection[], bundleKey: string | null = null) => {
    setSelection(next[next.length - 1] ?? null);
    setItems([...next]);
    setActiveBundleKey(bundleKey);
    setRevealRequest(null);
  }, []);
  /** Cmd/Ctrl+Click on a bundle: removes its items when all are selected, else adds the missing ones. */
  const toggleItems = useCallback(
    (next: readonly Selection[], bundleKey: string | null = null) => {
      const selected = (item: Selection) => selectedItems.some((c) => sameSelection(c, item));
      const removing = next.every(selected);
      const rest = removing
        ? selectedItems.filter((current) => !next.some((item) => sameSelection(item, current)))
        : [...selectedItems, ...next.filter((item) => !selected(item))];
      setSelection(rest[rest.length - 1] ?? null);
      setItems(rest);
      setActiveBundleKey(removing ? null : bundleKey);
      setRevealRequest(null);
    },
    [selectedItems]
  );

  useEffect(() => {
    if (shown.levelPath !== levelPath) {
      navigate(shown.levelPath);
    } else if (shown.selection !== selection) {
      setSelection(shown.selection);
      setActiveBundleKey(null);
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
    activeBundleKey,
    revealRequest,
    select,
    toggleSelection,
    selectItems,
    toggleItems,
    toggleNode: toggleSelection,
    selectAndReveal,
    revealMatch,
    navigate,
    enterHierarchy,
    toggleExpanded,
    selectInstance,
  };
}
