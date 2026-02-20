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
  object: unknown;
  breadcrumbs: string[];
  path: YamlPath;
  meta?: {
    absoluteAddress?: number;
    relativeOffset?: number;
    focusDetails?: boolean;
  };
}

interface SelectionState {
  id: string;
  type: Selection['type'] | null;
  object: unknown;
  breadcrumbs: string[];
  meta: Selection['meta'] | undefined;
  canGoBack: boolean;
}

const INITIAL_STATE: SelectionState = {
  id: '',
  type: null,
  object: null,
  breadcrumbs: [],
  meta: undefined,
  canGoBack: false,
};

const MAX_HISTORY_SIZE = 50;

/**
 * Hook for managing selection state with history for back navigation
 */
export function useSelection() {
  const [state, setState] = useState<SelectionState>(INITIAL_STATE);

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
    }

    selectionRef.current = selection;
    setState({
      id: selection.id,
      type: selection.type,
      object: selection.object,
      breadcrumbs: selection.breadcrumbs,
      meta: selection.meta,
      canGoBack: historyRef.current.length > 0,
    });
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
      setState({
        id: previous.id,
        type: previous.type,
        object: previous.object,
        breadcrumbs: previous.breadcrumbs,
        meta: previous.meta,
        canGoBack: historyRef.current.length > 0,
      });
    }
    return true;
  }, []);

  /**
   * Clear selection
   */
  const clearSelection = useCallback(() => {
    selectionRef.current = null;
    setState(INITIAL_STATE);
  }, []);

  return {
    selectedId: state.id,
    selectedType: state.type,
    selectedObject: state.object,
    breadcrumbs: state.breadcrumbs,
    selectionMeta: state.meta,
    selectionRef,
    handleSelect,
    clearSelection,
    goBack,
    canGoBack: state.canGoBack,
  };
}
