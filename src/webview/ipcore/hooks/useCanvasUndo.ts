import { useRef, useState, useCallback } from 'react';

interface UseCanvasUndoOptions {
  rawYaml: string;
  updateFromYaml: (text: string, fileName: string, imports?: Record<string, unknown>) => void;
  fileName: string;
  imports?: Record<string, unknown>;
}

/**
 * Undo/redo stack for canvas YAML edits.
 *
 * push() snapshots the current rawYaml before a mutation.
 * undo() / redo() restore snapshots via updateFromYaml.
 */
export function useCanvasUndo({
  rawYaml,
  updateFromYaml,
  fileName,
  imports,
}: UseCanvasUndoOptions) {
  const undoStack = useRef<string[]>([]);
  const redoStack = useRef<string[]>([]);

  const rawYamlRef = useRef(rawYaml);
  rawYamlRef.current = rawYaml;

  const importsRef = useRef(imports);
  importsRef.current = imports;

  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  const push = useCallback(() => {
    undoStack.current.push(rawYamlRef.current);
    redoStack.current = [];
    setCanUndo(true);
    setCanRedo(false);
  }, []);

  const undo = useCallback(() => {
    const prev = undoStack.current.pop();
    if (prev === undefined) {
      return;
    }
    redoStack.current.push(rawYamlRef.current);
    setCanUndo(undoStack.current.length > 0);
    setCanRedo(true);
    updateFromYaml(prev, fileName, importsRef.current);
  }, [updateFromYaml, fileName]);

  const redo = useCallback(() => {
    const next = redoStack.current.pop();
    if (next === undefined) {
      return;
    }
    undoStack.current.push(rawYamlRef.current);
    setCanUndo(true);
    setCanRedo(redoStack.current.length > 0);
    updateFromYaml(next, fileName, importsRef.current);
  }, [updateFromYaml, fileName]);

  return { push, undo, redo, canUndo, canRedo };
}
