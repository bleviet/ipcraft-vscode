import { useCallback, useMemo, useState } from 'react';
import { portId } from '../layout/levelEdges';
import type { PinFolding } from '../layout/pinGrouping';

/** How instance blocks show their pins: as cards (`arch`), folded (`compact`) or one row per pin (`full`). */
export type PinMode = 'arch' | 'compact' | 'full';

/**
 * The pin mode (Compact by default) and the open pin arrays. `folding` is the
 * layout input for `useElkLayout`: undefined shows every pin; its identity
 * changes only with the mode or the open arrays.
 */
export function usePinFolding(): {
  folding: PinFolding | undefined;
  mode: PinMode;
  setMode: (mode: PinMode) => void;
  togglePinGroup: (instancePath: string, groupId: string) => void;
} {
  const [mode, setMode] = useState<PinMode>('compact');
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  const folding = useMemo<PinFolding | undefined>(() => {
    if (mode === 'full') {
      return undefined;
    }
    return mode === 'arch' ? { open, arch: true } : { open };
  }, [mode, open]);
  const togglePinGroup = useCallback((instancePath: string, groupId: string) => {
    const key = portId(instancePath, groupId);
    setOpen((current) => {
      const next = new Set(current);
      if (!next.delete(key)) {
        next.add(key);
      }
      return next;
    });
  }, []);
  return { folding, mode, setMode, togglePinGroup };
}
