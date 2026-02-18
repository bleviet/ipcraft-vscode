import { useState, useRef, useCallback } from 'react';

/**
 * YAML path type
 */
export type YamlPath = Array<string | number>;

/**
 * Selection type
 */
export interface Selection {
  id: string;
  type: 'memoryMap' | 'block' | 'register' | 'array';
  object: any;
  breadcrumbs: string[];
  path: YamlPath;
  meta?: {
    absoluteAddress?: number;
    relativeOffset?: number;
    focusDetails?: boolean;
  };
}

const MAX_HISTORY_SIZE = 50;

/**
 * Hook for managing selection state with history for back navigation
 */
export function useSelection() {
  const [selectedId, setSelectedId] = useState<string>('');
  const [selectedType, setSelectedType] = useState<Selection['type'] | null>(null);
  const [selectedObject, setSelectedObject] = useState<any>(null);
  const [breadcrumbs, setBreadcrumbs] = useState<string[]>([]);
  const [selectionMeta, setSelectionMeta] = useState<Selection['meta'] | undefined>(undefined);
  const [canGoBack, setCanGoBack] = useState(false);

  // Use ref for callbacks that need current selection
  const selectionRef = useRef<Selection | null>(null);

  // History stack for back navigation
  const historyRef = useRef<Selection[]>([]);

  /**
   * Handle selection change
   * IMPORTANT: Wrapped in useCallback to prevent infinite loops in useEffect dependencies
   */
  const handleSelect = useCallback((selection: Selection, addToHistory = true) => {
    // Add current selection to history before changing (if different)
    if (addToHistory && selectionRef.current && selectionRef.current.id !== selection.id) {
      historyRef.current.push(selectionRef.current);
      // Limit history size
      if (historyRef.current.length > MAX_HISTORY_SIZE) {
        historyRef.current.shift();
      }
      setCanGoBack(true);
    }

    selectionRef.current = selection;
    setSelectedId(selection.id);
    setSelectedType(selection.type);
    setSelectedObject(selection.object);
    setBreadcrumbs(selection.breadcrumbs);
    setSelectionMeta(selection.meta);
  }, []);

  /**
   * Go back to previous selection
   */
  const goBack = useCallback(() => {
    if (historyRef.current.length === 0) {
      return false;
    }

    const previous = historyRef.current.pop();
    if (previous) {
      // Use handleSelect without adding to history to prevent cycles
      selectionRef.current = previous;
      setSelectedId(previous.id);
      setSelectedType(previous.type);
      setSelectedObject(previous.object);
      setBreadcrumbs(previous.breadcrumbs);
      setSelectionMeta(previous.meta);
    }

    setCanGoBack(historyRef.current.length > 0);
    return true;
  }, []);

  /**
   * Clear selection
   */
  const clearSelection = useCallback(() => {
    selectionRef.current = null;
    setSelectedId('');
    setSelectedType(null);
    setSelectedObject(null);
    setBreadcrumbs([]);
    setSelectionMeta(undefined);
  }, []);

  return {
    selectedId,
    selectedType,
    selectedObject,
    breadcrumbs,
    selectionMeta,
    selectionRef,
    handleSelect,
    clearSelection,
    goBack,
    canGoBack,
  };
}
