import { useCallback, useEffect, useRef, useState } from 'react';
import type { PinHoverTarget } from '../model';

export const HOVER_DELAY_MS = 150;

export interface PinHover {
  target: PinHoverTarget;
  anchor: DOMRect;
}

/**
 * Delayed pin hover state. `show` opens after {@link HOVER_DELAY_MS}; `hide`,
 * Escape, wheel, any pointer down, and a change of `resetKey` close it.
 */
export function usePinHover(resetKey: unknown): {
  hover: PinHover | null;
  onHoverPin: (target: PinHoverTarget | null, anchor?: DOMRect) => void;
} {
  const [hover, setHover] = useState<PinHover | null>(null);
  const timer = useRef<number | undefined>(undefined);

  const hide = useCallback(() => {
    window.clearTimeout(timer.current);
    setHover(null);
  }, []);

  const onHoverPin = useCallback(
    (target: PinHoverTarget | null, anchor?: DOMRect) => {
      if (!target || !anchor) {
        hide();
        return;
      }
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setHover({ target, anchor }), HOVER_DELAY_MS);
    },
    [hide]
  );

  useEffect(hide, [resetKey, hide]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        hide();
      }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('wheel', hide, { capture: true, passive: true });
    window.addEventListener('pointerdown', hide, true);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('wheel', hide, true);
      window.removeEventListener('pointerdown', hide, true);
      window.clearTimeout(timer.current);
    };
  }, [hide]);

  return { hover, onHoverPin };
}
