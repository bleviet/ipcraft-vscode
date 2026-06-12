import { useState, useCallback } from 'react';

export type PanelLayout = 'stacked' | 'side-by-side';

/**
 * Manages a stacked / side-by-side layout toggle for a single panel.
 */
export function useLayoutToggle(initial: PanelLayout = 'side-by-side') {
  const [layout, setLayout] = useState<PanelLayout>(initial);
  const toggle = useCallback(() => {
    setLayout((prev) => (prev === 'stacked' ? 'side-by-side' : 'stacked'));
  }, []);
  return { layout, toggle } as const;
}
