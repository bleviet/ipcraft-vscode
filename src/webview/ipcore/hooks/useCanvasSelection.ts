import { useState, useCallback } from 'react';

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

/**
 * Hook managing canvas selection state.
 *
 * Supports both single selection (click) and multi-selection (Shift+Click).
 * Multi-select is restricted to 'port' and 'interrupt' kinds to enable grouping.
 */
export function useCanvasSelection() {
  const [selected, setSelected] = useState<CanvasElement | null>(null);
  const [multiMap, setMultiMap] = useState<Map<string, CanvasElement>>(new Map());

  const select = useCallback((id: string | null) => {
    if (!id) {
      setSelected(null);
      setMultiMap(new Map());
      return;
    }

    const element = parseCanvasId(id);
    setSelected(element);
    setMultiMap(new Map());
  }, []);

  /** Toggle membership of an element in the multi-selection.
   *  Only port/interrupt kinds are accepted; others are silently ignored. */
  const shiftSelect = useCallback(
    (id: string) => {
      const element = parseCanvasId(id);
      if (!element || !GROUPABLE_KINDS.has(element.kind)) {
        return;
      }

      setMultiMap((prev) => {
        const next = new Map(prev);
        // On the first Shift+Click after a plain click, auto-include the
        // anchor so it doesn't need to be Shift+Clicked separately.
        if (next.size === 0 && selected && GROUPABLE_KINDS.has(selected.kind)) {
          next.set(selected.id, selected);
        }
        if (next.has(id)) {
          next.delete(id);
        } else {
          next.set(id, element);
        }
        return next;
      });

      // Ensure the primary single selection is also in the multi-set.
      setSelected((prev) => {
        if (!prev && element) {
          return element;
        }
        return prev;
      });
    },
    [selected]
  );

  const deselect = useCallback(() => {
    setSelected(null);
    setMultiMap(new Map());
  }, []);

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
