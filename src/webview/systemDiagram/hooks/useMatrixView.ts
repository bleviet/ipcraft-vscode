import { useCallback, useEffect, useState } from 'react';

/**
 * Whether the connectivity matrix is open. It belongs to the level it was
 * opened on, so leaving the level closes it. A pure view toggle: it touches no
 * layout, folding, bundling or isolation state.
 */
export function useMatrixView(levelPath: string) {
  const [openLevel, setOpenLevel] = useState<string | null>(null);
  const open = openLevel === levelPath;
  // Forget the level once left, so coming back does not reopen the matrix.
  useEffect(() => setOpenLevel((current) => (current === levelPath ? current : null)), [levelPath]);
  const toggle = useCallback(
    () => setOpenLevel((current) => (current === levelPath ? null : levelPath)),
    [levelPath]
  );
  const close = useCallback(() => setOpenLevel(null), []);
  return { open, toggle, close };
}
