import { useEffect } from 'react';
import type { RefObject } from 'react';
import { focusContainer } from '../shared/utils/focus';

export function useAutoFocus(
  ref: RefObject<HTMLElement | null>,
  enabled: boolean,
  dependencies: readonly unknown[] = []
): void {
  useEffect(() => {
    if (!enabled) {
      return;
    }
    const id = focusContainer(ref);
    return () => window.clearTimeout(id);
  }, [ref, enabled, ...dependencies]);
}
