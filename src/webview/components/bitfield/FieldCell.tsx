import React from 'react';
import { renderBitCellStyle } from './renderBitCellStyle';

interface FieldCellProps {
  bitValue: 0 | 1;
  isOutOfNewRange: boolean;
  isInNewRange: boolean;
  color: string;
  fieldIndex: number;
  ctrlDragActive: boolean;
  ctrlDragPreviewValid?: boolean;
  ctrlHeld: boolean;
  onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void;
  onPointerMove: () => void;
  onPointerEnter: (e: React.PointerEvent<HTMLDivElement>) => void;
}

const FieldCell = ({
  bitValue,
  isOutOfNewRange,
  isInNewRange,
  color,
  fieldIndex: _fieldIndex,
  ctrlDragActive,
  ctrlDragPreviewValid,
  ctrlHeld,
  onPointerDown,
  onPointerMove,
  onPointerEnter,
}: FieldCellProps) => {
  const { cellClassName, labelClassName, style } = renderBitCellStyle({
    bitValue,
    isOutOfNewRange,
    isInNewRange,
    colorToken: color,
    ctrlDragActive,
    ctrlDragPreviewValid,
    ctrlHeld,
    defaultCursor: 'pointer',
    outOfRangeOpacity: 0.3,
    normalOpacity: 1,
  });

  return (
    <div
      className={`w-10 h-20 flex items-center justify-center touch-none ${cellClassName}`}
      style={style}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerEnter={onPointerEnter}
    >
      <span className={labelClassName}>{bitValue}</span>
    </div>
  );
};

export default FieldCell;
