import { useCallback, useReducer } from 'react';

export type CanvasElementKind =
  | 'clock'
  | 'reset'
  | 'port'
  | 'busInterface'
  | 'body'
  | 'parameter'
  | 'interrupt'
  | 'subcore'
  | 'generics'
  | 'busInterfaceMatrix';

export interface CanvasElement {
  kind: CanvasElementKind;
  /** Index into the corresponding array (clocks[i], resets[i], etc.) */
  index: number;
  /** Stable identifier matching the layout port id (e.g., 'clock:0', 'bus:2') */
  id: string;
}

export interface CanvasMultiSelection {
  /** All selected elements, keyed by id */
  all: Map<string, CanvasElement>;
  /** True when 2+ groupable elements are selected */
  isMulti: boolean;
}

/** Kinds eligible for multi-select grouping */
const GROUPABLE_KINDS: ReadonlySet<CanvasElementKind> = new Set(['port', 'interrupt']);

/**
 * Parse a canvas layout port ID into a CanvasElement.
 * IDs follow the format `kind:index` (e.g., 'clock:0', 'bus:2', 'port:5').
 */
export function parseCanvasId(id: string): CanvasElement | null {
  if (id === 'body') {
    return { kind: 'body', index: 0, id: 'body' };
  }
  if (id === 'generics') {
    return { kind: 'generics', index: 0, id: 'generics' };
  }
  if (id === 'busInterfaceMatrix') {
    return { kind: 'busInterfaceMatrix', index: 0, id: 'busInterfaceMatrix' };
  }

  const parts = id.split(':');
  if (parts.length !== 2) {
    return null;
  }

  const [kindRaw, indexStr] = parts;
  const index = parseInt(indexStr, 10);
  if (isNaN(index)) {
    return null;
  }

  const kindMap: Record<string, CanvasElementKind> = {
    clock: 'clock',
    reset: 'reset',
    port: 'port',
    bus: 'busInterface',
    parameter: 'parameter',
    interrupt: 'interrupt',
    subcore: 'subcore',
  };

  const kind = kindMap[kindRaw];
  if (!kind) {
    return null;
  }

  return { kind, index, id };
}

interface SelectionState {
  selected: CanvasElement | null;
  multiMap: Map<string, CanvasElement>;
}

type SelectionAction =
  | { type: 'SELECT'; id: string | null }
  | { type: 'SHIFT_SELECT'; id: string }
  | { type: 'DESELECT' };

const initialSelectionState: SelectionState = { selected: null, multiMap: new Map() };

function selectionReducer(state: SelectionState, action: SelectionAction): SelectionState {
  switch (action.type) {
    case 'SELECT': {
      if (!action.id) {
        return initialSelectionState;
      }
      const element = parseCanvasId(action.id);
      return { selected: element, multiMap: new Map() };
    }
    case 'SHIFT_SELECT': {
      const element = parseCanvasId(action.id);
      if (!element || !GROUPABLE_KINDS.has(element.kind)) {
        return state;
      }

      const nextMap = new Map(state.multiMap);
      // On the first Shift+Click after a plain click, auto-include the
      // anchor so it doesn't need to be Shift+Clicked separately.
      if (nextMap.size === 0 && state.selected && GROUPABLE_KINDS.has(state.selected.kind)) {
        nextMap.set(state.selected.id, state.selected);
      }
      if (nextMap.has(action.id)) {
        nextMap.delete(action.id);
      } else {
        nextMap.set(action.id, element);
      }

      // Ensure the primary single selection is also in the multi-set.
      const nextSelected = state.selected ?? element;

      return { selected: nextSelected, multiMap: nextMap };
    }
    case 'DESELECT':
      return initialSelectionState;
    default:
      return state;
  }
}

/**
 * Hook managing canvas selection state.
 *
 * Supports both single selection (click) and multi-selection (Shift+Click).
 * Multi-select is restricted to 'port' and 'interrupt' kinds to enable grouping.
 */
export function useCanvasSelection() {
  const [{ selected, multiMap }, dispatch] = useReducer(selectionReducer, initialSelectionState);

  const select = useCallback((id: string | null) => dispatch({ type: 'SELECT', id }), []);

  /** Toggle membership of an element in the multi-selection.
   *  Only port/interrupt kinds are accepted; others are silently ignored. */
  const shiftSelect = useCallback((id: string) => dispatch({ type: 'SHIFT_SELECT', id }), []);

  const deselect = useCallback(() => dispatch({ type: 'DESELECT' }), []);

  const multiSelection: CanvasMultiSelection = {
    all: multiMap,
    isMulti: multiMap.size >= 2,
  };

  const isInMultiSelection = useCallback((id: string): boolean => multiMap.has(id), [multiMap]);

  return {
    /** Primary single-selected element (for inspector compatibility) */
    selected,
    /** Alias for selected?.id */
    selectedId: selected?.id ?? null,
    /** Multi-select state */
    multiSelection,
    /** Returns true if the given id is in the multi-selection set */
    isInMultiSelection,
    select,
    shiftSelect,
    deselect,
    /** Alias for deselect */
    deselectAll: deselect,
  };
}
