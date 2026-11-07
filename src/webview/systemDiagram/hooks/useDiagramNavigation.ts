import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SystemGraph } from '../../../domain/systemGraph';
import { isShownNode, levelNodeOf, pruneExpanded, targetLevel } from '../expansion';
import { nodeSelection, reconcileNavigation, type RevealRequest, type Selection } from '../model';

/**
 * Current level, expanded hierarchy blocks and selection of the diagram, and
 * the gestures that change them. `selection` is the primary item (it drives
 * Details); `selectedNodeIds` are all selected nodes of the view (Cmd/Ctrl+Click
 * adds to them). The expanded blocks are a set of instance paths that survives
 * navigation: entering a block shows its own expanded children expanded.
 */
export function useDiagramNavigation(graph: SystemGraph) {
  const [levelPath, setLevelPath] = useState('/');
  const [selection, setSelection] = useState<Selection | null>(null);
  const [nodeIds, setNodeIds] = useState<string[]>([]);
  const [revealRequest, setRevealRequest] = useState<RevealRequest | null>(null);
  const [expandedState, setExpandedState] = useState<ReadonlySet<string>>(() => new Set());
  const expanded = useMemo(() => pruneExpanded(graph, expandedState), [graph, expandedState]);
  const lastToken = useRef(0);

  const select = useCallback(
    (next: Selection | null, level?: string) => {
      setSelection(next);
      setNodeIds(next && next.kind !== 'net' ? [next.id] : []);
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
    setNodeIds([]);
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
  const selectedNodeIds = useMemo(() => {
    const { selection: current, levelPath: level } = shown;
    if (!current || current.kind === 'net') {
      return [];
    }
    const ids = nodeIds.filter((id) => isShownNode(graph, level, expanded, id));
    return ids.includes(current.id) ? ids : [current.id];
  }, [graph, expanded, shown, nodeIds]);
  /** Cmd/Ctrl+Click: adds the node to the selection, or removes it when already selected. */
  const toggleNode = useCallback(
    (node: Selection) => {
      if (!selectedNodeIds.includes(node.id)) {
        setSelection(node);
        setNodeIds([...selectedNodeIds, node.id]);
      } else {
        const rest = selectedNodeIds.filter((id) => id !== node.id);
        const last = rest[rest.length - 1];
        setSelection(last === undefined ? null : nodeSelection(last));
        setNodeIds(rest);
      }
      setRevealRequest(null);
    },
    [graph, selectedNodeIds]
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
    selectedNodeIds,
    revealRequest,
    select,
    toggleNode,
    selectAndReveal,
    revealMatch,
    navigate,
    enterHierarchy,
    toggleExpanded,
    selectInstance,
  };
}
