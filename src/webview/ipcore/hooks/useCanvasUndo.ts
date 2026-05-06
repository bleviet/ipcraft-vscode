import { useCallback, useEffect, useState } from 'react';
import type { useIpCoreState } from './useIpCoreState';

interface UseCanvasUndoOptions {
  rawYaml: string;
  updateFromYaml: ReturnType<typeof useIpCoreState>['updateFromYaml'];
  fileName: string;
}

/**
 * Provides a local undo/redo stack for the IP Core Canvas.
 * Captures raw YAML snapshots and restores them.
 */
export function useCanvasUndo({ rawYaml, updateFromYaml, fileName }: UseCanvasUndoOptions) {
  const [undoStack, setUndoStack] = useState<string[]>([]);
  const [redoStack, setRedoStack] = useState<string[]>([]);

  const push = useCallback(() => {
    if (rawYaml) {
      setUndoStack((prev) => [...prev, rawYaml]);
      setRedoStack([]); // Clear redo stack on new action
    }
  }, [rawYaml]);

  const undo = useCallback(() => {
    if (undoStack.length === 0) {
      return;
    }
    const previousYaml = undoStack[undoStack.length - 1];
    setUndoStack((prev) => prev.slice(0, -1));
    setRedoStack((prev) => [...prev, rawYaml]);
    updateFromYaml(previousYaml, fileName);
  }, [undoStack, rawYaml, updateFromYaml, fileName]);

  const redo = useCallback(() => {
    if (redoStack.length === 0) {
      return;
    }
    const nextYaml = redoStack[redoStack.length - 1];
    setRedoStack((prev) => prev.slice(0, -1));
    setUndoStack((prev) => [...prev, rawYaml]);
    updateFromYaml(nextYaml, fileName);
  }, [redoStack, rawYaml, updateFromYaml, fileName]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl+Z (or Cmd+Z on Mac)
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      }
      // Ctrl+Y or Ctrl+Shift+Z
      if (
        ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') ||
        ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'z')
      ) {
        e.preventDefault();
        redo();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [undo, redo]);

  return {
    push,
    undo,
    redo,
    canUndo: undoStack.length > 0,
    canRedo: redoStack.length > 0,
  };
}
