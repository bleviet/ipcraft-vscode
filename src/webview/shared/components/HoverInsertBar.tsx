import React from 'react';

export interface HoverInsertBarProps {
  gapIndex: number | null;
  positionY: number | null;
  /** Used in the button title, e.g. "register" or "block". */
  itemLabel: string;
  onInsert: (gapIndex: number) => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}

export function HoverInsertBar({
  gapIndex,
  positionY,
  itemLabel,
  onInsert,
  onMouseEnter,
  onMouseLeave,
}: HoverInsertBarProps) {
  if (gapIndex === null || positionY === null) {
    return null;
  }

  return (
    <div
      className="absolute left-0 right-0 z-20 flex items-center px-4 pointer-events-none"
      style={{ top: positionY, transform: 'translateY(-50%)' }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div
        className="flex-1 h-[2px] rounded-full"
        style={{ background: 'linear-gradient(to right, #f97316, #f43f5e)' }}
      />
      <button
        className="pointer-events-auto w-5 h-5 rounded-full text-white text-[11px] font-bold flex items-center justify-center hover:scale-110 transition-transform shadow mx-1 flex-shrink-0"
        style={{ background: 'linear-gradient(135deg, #f97316, #f43f5e)' }}
        title={`Insert ${itemLabel} at position ${gapIndex}`}
        onClick={(e) => {
          e.stopPropagation();
          onInsert(gapIndex);
        }}
      >
        +
      </button>
      <div
        className="flex-1 h-[2px] rounded-full"
        style={{ background: 'linear-gradient(to left, #f97316, #f43f5e)' }}
      />
    </div>
  );
}
