import { useCallback, useState } from 'react';
import type { SystemGraph } from '../../../domain/systemGraph';
import { selectionLevel, type Selection } from '../model';

/** Current level and selection of the diagram, and the gestures that change them. */
export function useDiagramNavigation(graph: SystemGraph) {
  const [levelPath, setLevelPath] = useState('/');
  const [selection, setSelection] = useState<Selection | null>(null);

  const select = useCallback(
    (next: Selection | null, level?: string) => {
      setSelection(next);
      const target = level ?? (next ? selectionLevel(graph, next) : undefined);
      if (target !== undefined) {
        setLevelPath(target);
      }
    },
    [graph]
  );
  const navigate = useCallback((path: string) => {
    setLevelPath(path);
    setSelection(null);
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
    (instancePath: string) => select({ kind: 'instance', id: instancePath }),
    [select]
  );

  return { levelPath, selection, select, navigate, enterHierarchy, selectInstance };
}
