import { useEffect } from 'react';

const BACK_BUTTON = 3;
const FORWARD_BUTTON = 4;

/**
 * Calls `onBack` or `onForward` when the mouse back (`button === 3`) or
 * forward (`button === 4`) button is released anywhere in the window.
 */
export function useMouseNavigationButtons(onBack: () => void, onForward: () => void): void {
  useEffect(() => {
    const onMouseUp = (event: MouseEvent) => {
      if (event.button === BACK_BUTTON) {
        event.preventDefault();
        onBack();
      } else if (event.button === FORWARD_BUTTON) {
        event.preventDefault();
        onForward();
      }
    };
    window.addEventListener('mouseup', onMouseUp);
    return () => window.removeEventListener('mouseup', onMouseUp);
  }, [onBack, onForward]);
}
