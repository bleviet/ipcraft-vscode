import { useEffect, useState } from 'react';
import { SHIFT_DRAG_INITIAL, type ShiftDragState } from './types';

interface UseShiftDragOptions {
  onResizeCommit?: (fieldIndex: number, newRange: [number, number]) => void;
  onCreateCommit?: (newRange: [number, number]) => void;
}

export function useShiftDrag({ onResizeCommit, onCreateCommit }: UseShiftDragOptions) {
  const [shiftDrag, setShiftDrag] = useState<ShiftDragState>(SHIFT_DRAG_INITIAL);
  const [shiftHeld, setShiftHeld] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Shift' && !shiftDrag.active) {
        setShiftHeld(true);
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Shift') {
        setShiftHeld(false);
      }
    };
    const handleBlur = () => {
      setShiftHeld(false);
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleBlur);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleBlur);
    };
  }, [shiftDrag.active]);

  useEffect(() => {
    if (!shiftDrag.active) {
      return;
    }

    const commitShiftDrag = () => {
      if (shiftDrag.mode === 'resize' && shiftDrag.targetFieldIndex !== null) {
        const newLo = Math.min(shiftDrag.anchorBit, shiftDrag.currentBit);
        const newHi = Math.max(shiftDrag.anchorBit, shiftDrag.currentBit);
        if (newLo <= newHi) {
          onResizeCommit?.(shiftDrag.targetFieldIndex, [newHi, newLo]);
        }
      } else if (shiftDrag.mode === 'create') {
        const lo = Math.min(shiftDrag.anchorBit, shiftDrag.currentBit);
        const hi = Math.max(shiftDrag.anchorBit, shiftDrag.currentBit);
        if (lo <= hi) {
          onCreateCommit?.([hi, lo]);
        }
      }
      setShiftDrag(SHIFT_DRAG_INITIAL);
    };

    const cancelShiftDrag = () => setShiftDrag(SHIFT_DRAG_INITIAL);
    window.addEventListener('pointerup', commitShiftDrag);
    window.addEventListener('pointercancel', cancelShiftDrag);
    window.addEventListener('blur', cancelShiftDrag);
    return () => {
      window.removeEventListener('pointerup', commitShiftDrag);
      window.removeEventListener('pointercancel', cancelShiftDrag);
      window.removeEventListener('blur', cancelShiftDrag);
    };
  }, [shiftDrag, onResizeCommit, onCreateCommit]);

  return {
    shiftDrag,
    setShiftDrag,
    shiftHeld,
  };
}
