import { useCallback, useMemo, useState } from 'react';
import { portId } from '../layout/levelEdges';
import type { PinFolding } from '../layout/pinGrouping';

/**
 * Compact pins (on by default) and the open pin arrays. `folding` is the layout
 * input for `useElkLayout`: undefined shows every pin; its identity changes only
 * with the mode or the open arrays.
 */
export function usePinFolding(): {
  folding: PinFolding | undefined;
  compact: boolean;
  setCompact: (compact: boolean) => void;
  togglePinGroup: (instancePath: string, groupId: string) => void;
} {
  const [compact, setCompact] = useState(true);
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  const folding = useMemo(() => (compact ? { open } : undefined), [compact, open]);
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
  return { folding, compact, setCompact, togglePinGroup };
}
