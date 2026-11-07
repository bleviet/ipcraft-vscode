import { useCallback, useMemo, useState } from 'react';
import type { BusBundling } from '../layout/edgeBundling';

/**
 * Bundle buses (on by default) and the bundles the user unbundled. `busBundling`
 * is the layout input for `useElkLayout`: undefined draws every wire on its own;
 * its identity changes only with the mode or the unbundled set.
 */
export function useBusBundling(): {
  busBundling: BusBundling | undefined;
  on: boolean;
  setOn: (on: boolean) => void;
  unbundle: (key: string) => void;
} {
  const [on, setOn] = useState(true);
  const [unbundled, setUnbundled] = useState<ReadonlySet<string>>(() => new Set());
  const busBundling = useMemo(() => (on ? { unbundled } : undefined), [on, unbundled]);
  const unbundle = useCallback((key: string) => {
    setUnbundled((current) => new Set(current).add(key));
  }, []);
  return { busBundling, on, setOn, unbundle };
}
