import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SystemGraph } from '../../../domain/systemGraph';
import { reconcileNavigation, selectionLevel, type RevealRequest, type Selection } from '../model';

/** Current level and selection of the diagram, and the gestures that change them. */
export function useDiagramNavigation(graph: SystemGraph) {
  const [levelPath, setLevelPath] = useState('/');
  const [selection, setSelection] = useState<Selection | null>(null);
  const [revealRequest, setRevealRequest] = useState<RevealRequest | null>(null);
  const lastToken = useRef(0);

  const select = useCallback(
    (next: Selection | null, level?: string) => {
      setSelection(next);
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
    (next: Selection | null, level?: string) => {
      select(next, level);
      const target = level ?? (next ? selectionLevel(graph, next) : undefined);
      if (next && next.kind !== 'net' && target !== undefined) {
        lastToken.current += 1;
        setRevealRequest({ token: lastToken.current, selection: next, levelPath: target });
      }
    },
    [graph, select]
  );
  const navigate = useCallback((path: string) => {
    setLevelPath(path);
    setSelection(null);
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
    revealRequest,
    select,
    selectAndReveal,
    navigate,
    enterHierarchy,
    selectInstance,
  };
}
