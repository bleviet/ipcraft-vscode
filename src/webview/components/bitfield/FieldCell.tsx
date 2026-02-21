import React from 'react';
import { FIELD_COLORS } from '../../shared/colors';

interface FieldCellProps {
  bitValue: 0 | 1;
  cellIndex: number;
  width: number;
  isSingleBit: boolean;
  isOutOfNewRange: boolean;
  isInNewRange: boolean;
  color: string;
  fieldIndex: number;
  ctrlDragActive: boolean;
  ctrlHeld: boolean;
  onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void;
  onPointerMove: () => void;
  onPointerEnter: (e: React.PointerEvent<HTMLDivElement>) => void;
}

const FieldCell = ({
  bitValue,
  cellIndex,
  width,
  isSingleBit,
  isOutOfNewRange,
  isInNewRange,
  color,
  fieldIndex: _fieldIndex,
  ctrlDragActive,
  ctrlHeld,
  onPointerDown,
  onPointerMove,
  onPointerEnter,
}: FieldCellProps) => {
  return (
    <div
      className={`w-10 h-20 flex items-center justify-center touch-none ${bitValue === 1 && !isOutOfNewRange ? 'ring-1 ring-white/70 ring-inset' : ''} ${
        isSingleBit
          ? 'rounded-md'
          : cellIndex === 0
            ? 'rounded-l-md'
            : cellIndex === width - 1
              ? 'rounded-r-md'
              : ''
      }`}
      style={{
        backgroundColor: isOutOfNewRange ? 'var(--vscode-editor-background)' : FIELD_COLORS[color],
        opacity: isOutOfNewRange ? 0.3 : 1,
        boxShadow:
          bitValue === 1 && !isOutOfNewRange
            ? 'inset 0 0 0 1px var(--ipcraft-pattern-ring)'
            : undefined,
        border: isInNewRange ? '2px solid var(--vscode-focusBorder)' : undefined,
        cursor: ctrlDragActive ? 'grabbing' : ctrlHeld ? 'grab' : 'pointer',
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerEnter={onPointerEnter}
    >
      <span
        className={`ipcraft-pattern-label text-sm font-mono select-none ${bitValue === 1 ? 'font-bold' : 'font-normal'}`}
      >
        {bitValue}
      </span>
    </div>
  );
};

export default FieldCell;
