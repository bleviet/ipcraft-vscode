import { useCallback, useState } from 'react';
import { useCanvasSelection } from './useCanvasSelection';

/**
 * Canvas selection controller: composes the reducer-backed `useCanvasSelection`
 * (single + multi-select) with the individually-selected bus sub-port id.
 *
 * The sub-port id is kept separate from the primary selection (which stays on
 * the parent bus interface so the inspector panel keeps showing it) so Delete
 * can target just the one signal instead of the whole bus interface — see
 * `subPortId` handling in `useCanvasCommands`.
 *
 * `select` mirrors `IpCoreApp`'s prior `handleCanvasSelect` wrapper: any plain
 * element selection clears the sub-port selection. `deselect`/`deselectAll`/
 * `shiftSelect` are passed through unchanged — callers that need the sub-port
 * cleared alongside those call `clearSubPort()` explicitly, matching the
 * pre-refactor call sites exactly.
 */
export function useIpCoreSelectionController() {
  const canvasSelection = useCanvasSelection();
  const [selectedSubPortId, setSelectedSubPortId] = useState<string | null>(null);

  const select = useCallback(
    (id: string | null) => {
      setSelectedSubPortId(null);
      canvasSelection.select(id);
    },
    [canvasSelection]
  );

  const selectSubPort = useCallback((id: string) => setSelectedSubPortId(id), []);
  const clearSubPort = useCallback(() => setSelectedSubPortId(null), []);

  return {
    ...canvasSelection,
    select,
    selectedSubPortId,
    selectSubPort,
    clearSubPort,
  };
}
