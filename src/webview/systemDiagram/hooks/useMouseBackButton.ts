import { useEffect } from 'react';

const BACK_BUTTON = 3;

/** Calls `onBack` when the mouse back button (`button === 3`) is released anywhere in the window. */
export function useMouseBackButton(onBack: () => void): void {
  useEffect(() => {
    const onMouseUp = (event: MouseEvent) => {
      if (event.button === BACK_BUTTON) {
        event.preventDefault();
        onBack();
      }
    };
    window.addEventListener('mouseup', onMouseUp);
    return () => window.removeEventListener('mouseup', onMouseUp);
  }, [onBack]);
}
