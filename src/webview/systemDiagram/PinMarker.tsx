import React from 'react';
import { categoryColor } from './colors';
import type { NetCategory } from '../../domain/systemGraph';
import { CIRCLE_MARKER, SQUARE_MARKER } from './layout/pinRows';

interface PinMarkerProps {
  isInterface: boolean;
  category?: NetCategory;
  /** Hollow (node-colored fill, colored stroke) for a pin with no nets. */
  hollow?: boolean;
  /** Overrides the category color: the clock domain of a clock pin in the domain mode. */
  color?: string;
  /** Border the marker sits on. */
  side: 'west' | 'east';
  /** Gap between the positioned parent's edge and the node's outer edge. */
  inset?: number;
  top?: number | string;
}

/** Pin marker centred on the block border: 8 px square for interfaces, 6 px circle for signals. */
export function PinMarker({
  isInterface,
  category,
  hollow,
  color: override,
  side,
  inset = 1,
  top = '50%',
}: PinMarkerProps) {
  const size = isInterface ? SQUARE_MARKER : CIRCLE_MARKER;
  const color = override ?? categoryColor(category);
  return (
    <span
      aria-hidden="true"
      className="sd-pin-marker"
      style={{
        [side === 'west' ? 'left' : 'right']: -(size / 2) - inset,
        top,
        width: size,
        height: size,
        marginTop: -size / 2,
        borderRadius: isInterface ? 1 : '50%',
        boxSizing: 'border-box',
        background: hollow ? 'var(--vscode-editor-background)' : color,
        border: hollow ? `1.5px solid ${color}` : undefined,
      }}
    />
  );
}
