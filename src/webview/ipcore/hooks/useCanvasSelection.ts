import { useState, useCallback } from 'react';

export type CanvasElementKind = 'clock' | 'reset' | 'port' | 'busInterface' | 'body';

export interface CanvasElement {
  kind: CanvasElementKind;
  /** Index into the corresponding array (clocks[i], resets[i], etc.) */
  index: number;
  /** Stable identifier matching the layout port id (e.g., 'clock:0', 'bus:2') */
  id: string;
}

/**
 * Parse a canvas layout port ID into a CanvasElement.
 * IDs follow the format `kind:index` (e.g., 'clock:0', 'bus:2', 'port:5').
 */
export function parseCanvasId(id: string): CanvasElement | null {
  const parts = id.split(':');
  if (parts.length !== 2) {
    return null;
  }

  const [kindRaw, indexStr] = parts;
  const index = parseInt(indexStr, 10);
  if (isNaN(index)) {
    return null;
  }

  // Map layout kind to element kind
  const kindMap: Record<string, CanvasElementKind> = {
    clock: 'clock',
    reset: 'reset',
    port: 'port',
    bus: 'busInterface',
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
 * Translates between canvas port IDs (e.g., 'bus:0') and structured CanvasElement objects.
 */
export function useCanvasSelection() {
  const [selected, setSelected] = useState<CanvasElement | null>(null);

  const select = useCallback((id: string | null) => {
    if (!id) {
      setSelected(null);
      return;
    }

    const element = parseCanvasId(id);
    setSelected(element);
  }, []);

  const deselect = useCallback(() => {
    setSelected(null);
  }, []);

  return {
    selected,
    selectedId: selected?.id ?? null,
    select,
    deselect,
  };
}
