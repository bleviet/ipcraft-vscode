import React from 'react';
import type { SeparatorProps } from './hooks/usePanelResize';

interface ResizeHandleProps extends SeparatorProps {
  label: string;
}

/** Draggable, keyboard-operable separator between the canvas and a panel. */
export function ResizeHandle({
  label,
  orientation,
  value,
  min,
  max,
  ...handlers
}: ResizeHandleProps) {
  return (
    <div
      role="separator"
      tabIndex={0}
      aria-label={label}
      aria-orientation={orientation}
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      className={`sd-resize ${orientation === 'vertical' ? 'sd-resize-vertical' : 'sd-resize-horizontal'}`}
      {...handlers}
    />
  );
}
