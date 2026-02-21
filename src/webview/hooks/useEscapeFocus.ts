import { useEffect } from 'react';
import type { RefObject } from 'react';
import { focusContainer } from '../shared/utils/focus';

export function useEscapeFocus(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') {
        return;
      }

      const activeEl = document.activeElement as HTMLElement | null;
      if (
        !activeEl ||
        !ref.current ||
        !ref.current.contains(activeEl) ||
        activeEl === ref.current
      ) {
        return;
      }

      e.preventDefault();
      e.stopPropagation();

      try {
        activeEl.blur?.();
      } catch {
        return;
      } finally {
        focusContainer(ref);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [ref]);
}
