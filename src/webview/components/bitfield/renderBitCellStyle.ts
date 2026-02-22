import type { CSSProperties } from 'react';
import { FIELD_COLORS } from '../../shared/colors';

interface RenderBitCellStyleArgs {
  bitValue: 0 | 1;
  isOutOfNewRange: boolean;
  isInNewRange: boolean;
  colorToken: string;
  ctrlDragActive: boolean;
  ctrlHeld: boolean;
  defaultCursor?: CSSProperties['cursor'];
  outOfRangeOpacity?: number;
  normalOpacity?: number;
  inRangeOpacity?: number;
}

interface RenderBitCellStyleResult {
  cellClassName: string;
  labelClassName: string;
  style: CSSProperties;
}

export function renderBitCellStyle({
  bitValue,
  isOutOfNewRange,
  isInNewRange,
  colorToken,
  ctrlDragActive,
  ctrlHeld,
  defaultCursor = 'pointer',
  outOfRangeOpacity = 0.3,
  normalOpacity = 1,
  inRangeOpacity,
}: RenderBitCellStyleArgs): RenderBitCellStyleResult {
  const resolvedColor = colorToken === 'gray' ? '#e5e7eb' : FIELD_COLORS[colorToken] || colorToken;
  const activeRangeOpacity = inRangeOpacity ?? normalOpacity;

  return {
    cellClassName: bitValue === 1 && !isOutOfNewRange ? 'ring-1 ring-white/70 ring-inset' : '',
    labelClassName: `ipcraft-pattern-label text-sm font-mono select-none ${bitValue === 1 ? 'font-bold' : 'font-normal'}`,
    style: {
      backgroundColor: isOutOfNewRange ? 'var(--vscode-editor-background)' : resolvedColor,
      opacity: isOutOfNewRange
        ? outOfRangeOpacity
        : isInNewRange
          ? activeRangeOpacity
          : normalOpacity,
      boxShadow:
        bitValue === 1 && !isOutOfNewRange
          ? 'inset 0 0 0 1px var(--ipcraft-pattern-ring)'
          : undefined,
      border: isInNewRange ? '2px solid var(--vscode-focusBorder)' : undefined,
      cursor: ctrlDragActive ? 'grabbing' : ctrlHeld ? 'grab' : defaultCursor,
    },
  };
}
