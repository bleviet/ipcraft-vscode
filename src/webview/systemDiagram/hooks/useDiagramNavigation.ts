import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SystemGraph } from '../../../domain/systemGraph';
import {
  isLevelNode,
  nodeSelection,
  reconcileNavigation,
  selectionLevel,
  type RevealRequest,
  type Selection,
} from '../model';

/**
 * Current level and selection of the diagram, and the gestures that change
 * them. `selection` is the primary item (it drives Details); `selectedNodeIds`
 * are all selected nodes of the level (Cmd/Ctrl+Click adds to them).
 */
export function useDiagramNavigation(graph: SystemGraph) {
  const [levelPath, setLevelPath] = useState('/');
  const [selection, setSelection] = useState<Selection | null>(null);
  const [nodeIds, setNodeIds] = useState<string[]>([]);
  const [revealRequest, setRevealRequest] = useState<RevealRequest | null>(null);
  const lastToken = useRef(0);

  const select = useCallback(
    (next: Selection | null, level?: string) => {
      setSelection(next);
      setNodeIds(next && next.kind !== 'net' ? [next.id] : []);
      setRevealRequest(null);
      const target = level ?? (next ? selectionLevel(graph, next) : undefined);
      if (target !== undefined) {
        setLevelPath(target);
      }
    },
    [graph]
  );
  /** Selection made outside the canvas: also centres the selected node. */
  const selectAndReveal = useCallback(
    (next: Selection | null, level?: string, readable?: true) => {
      select(next, level);
      const target = level ?? (next ? selectionLevel(graph, next) : undefined);
      if (next && next.kind !== 'net' && target !== undefined) {
        lastToken.current += 1;
        setRevealRequest({
          token: lastToken.current,
          selection: next,
          levelPath: target,
          ...(readable && { readable }),
        });
      }
    },
    [graph, select]
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
    const ids = nodeIds.filter((id) => isLevelNode(graph, level, id));
    return ids.includes(current.id) ? ids : [current.id];
  }, [graph, shown, nodeIds]);
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
    selection: shown.selection,
    selectedNodeIds,
    revealRequest,
    select,
    toggleNode,
    selectAndReveal,
    revealMatch,
    navigate,
    enterHierarchy,
    selectInstance,
  };
}
