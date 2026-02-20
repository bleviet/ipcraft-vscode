export type ProSegment =
  | {
      type: 'field';
      idx: number;
      start: number;
      end: number;
      name: string;
      color: string;
    }
  | { type: 'gap'; start: number; end: number };

export interface ShiftDragState {
  active: boolean;
  mode: 'resize' | 'create';
  targetFieldIndex: number | null;
  resizeEdge: 'msb' | 'lsb' | null;
  originalRange: { lo: number; hi: number } | null;
  anchorBit: number;
  currentBit: number;
  minBit: number;
  maxBit: number;
}

export const SHIFT_DRAG_INITIAL: ShiftDragState = {
  active: false,
  mode: 'resize',
  targetFieldIndex: null,
  resizeEdge: null,
  originalRange: null,
  anchorBit: 0,
  currentBit: 0,
  minBit: 0,
  maxBit: 31,
};

export interface CtrlDragState {
  active: boolean;
  draggedFieldIndex: number | null;
  previewSegments: ProSegment[] | null;
}

export const CTRL_DRAG_INITIAL: CtrlDragState = {
  active: false,
  draggedFieldIndex: null,
  previewSegments: null,
};
