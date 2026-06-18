import React from 'react';

export interface HoverInsertKind {
  value: string;
  label: string;
  icon: string;
}

export interface HoverInsertBarProps {
  gapIndex: number | null;
  positionY: number | null;
  /** Used in the button title, e.g. "register" or "block". Ignored when `kinds` is set. */
  itemLabel: string;
  /** When provided, renders one "+" button per kind instead of a single generic one. */
  kinds?: HoverInsertKind[];
  onInsert: (gapIndex: number, kind?: string) => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}

export function HoverInsertBar({
  gapIndex,
  positionY,
  itemLabel,
  kinds,
  onInsert,
  onMouseEnter,
  onMouseLeave,
}: HoverInsertBarProps) {
  if (gapIndex === null || positionY === null) {
    return null;
  }

  const buttons = kinds ?? [{ value: '', label: itemLabel, icon: '+' }];

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
      <div className="pointer-events-auto flex items-center gap-1 mx-1 flex-shrink-0">
        {buttons.map((kind) => (
          <button
            key={kind.value || 'default'}
            className="w-5 h-5 rounded-full text-white text-[11px] font-bold flex items-center justify-center hover:scale-110 transition-transform shadow flex-shrink-0"
            style={{ background: 'linear-gradient(135deg, #f97316, #f43f5e)' }}
            title={`Insert ${kind.label} at position ${gapIndex}`}
            onClick={(e) => {
              e.stopPropagation();
              onInsert(gapIndex, kind.value || undefined);
            }}
          >
            {kind.icon}
          </button>
        ))}
      </div>
      <div
        className="flex-1 h-[2px] rounded-full"
        style={{ background: 'linear-gradient(to left, #f97316, #f43f5e)' }}
      />
    </div>
  );
}
