import { useEffect, useRef, useState } from 'react';
import { CTRL_DRAG_INITIAL, type CtrlDragState, type ProSegment } from './types';

interface UseCtrlDragOptions {
  onCommitPreview?: (preview: ProSegment[]) => void;
  onCancelPreview?: () => void;
}

export function useCtrlDrag({ onCommitPreview, onCancelPreview }: UseCtrlDragOptions) {
  const [ctrlDrag, setCtrlDrag] = useState<CtrlDragState>(CTRL_DRAG_INITIAL);
  const ctrlDragRef = useRef<CtrlDragState>(ctrlDrag);
  const [ctrlHeld, setCtrlHeld] = useState(false);

  useEffect(() => {
    ctrlDragRef.current = ctrlDrag;
  }, [ctrlDrag]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.key === 'Control' || e.key === 'Meta') && !ctrlDrag.active) {
        setCtrlHeld(true);
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Control' || e.key === 'Meta') {
        setCtrlHeld(false);
      }
    };
    const handleBlur = () => {
      setCtrlHeld(false);
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleBlur);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleBlur);
    };
  }, [ctrlDrag.active]);

  useEffect(() => {
    if (!ctrlDrag.active) {
      return;
    }

    const commitCtrlDrag = () => {
      if (ctrlDrag.previewSegments) {
        onCommitPreview?.(ctrlDrag.previewSegments);
      }
      onCancelPreview?.();
      requestAnimationFrame(() => {
        setCtrlDrag(CTRL_DRAG_INITIAL);
      });
    };

    const cancelCtrlDrag = () => {
      onCancelPreview?.();
      setCtrlDrag(CTRL_DRAG_INITIAL);
    };

    window.addEventListener('pointerup', commitCtrlDrag);
    window.addEventListener('pointercancel', cancelCtrlDrag);
    window.addEventListener('blur', cancelCtrlDrag);
    return () => {
      window.removeEventListener('pointerup', commitCtrlDrag);
      window.removeEventListener('pointercancel', cancelCtrlDrag);
      window.removeEventListener('blur', cancelCtrlDrag);
    };
  }, [ctrlDrag, onCommitPreview, onCancelPreview]);

  return {
    ctrlDrag,
    setCtrlDrag,
    ctrlDragRef,
    ctrlHeld,
  };
}
