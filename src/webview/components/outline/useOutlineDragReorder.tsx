import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { parseOutlineId } from './outlineIds';
import type { OutlineReorder } from './types';

/**
 * Describes the in-progress reorder so the tree can reflow its rows into the
 * prospective drop order (live preview). `fromIdx`/`toIdx` are real indices
 * within the affected sibling group; `after` means dropping below the target.
 */
export type OutlinePreviewMove =
  | { kind: 'block'; fromIdx: number; toIdx: number; after: boolean }
  | { kind: 'register'; blockIndex: number; fromIdx: number; toIdx: number; after: boolean };

/**
 * Drag-to-reorder props wired onto a single outline row. The node renders
 * `dragHandle` and binds the pointer handlers to its root row element.
 */
export interface OutlineDragProps {
  dragHandle: React.ReactNode;
  onRowPointerMove: (e: React.PointerEvent) => void;
  onRowPointerEnter: () => void;
  isDragging: boolean;
}

type DragPosition = 'before' | 'after';

interface DragState {
  active: boolean;
  fromId: string | null;
  toId: string | null;
  position: DragPosition;
}

const IDLE: DragState = { active: false, fromId: null, toId: null, position: 'before' };

/**
 * Outline tree drag-to-reorder. Ports the MemoryMapEditor drag pattern:
 * pointerdown on a handle starts a drag, pointermove over a sibling row sets
 * the drop target + position (top/bottom half), pointerup commits a move via
 * `onReorder`. Only same-kind, same-sibling-group moves are emitted.
 */
export function useOutlineDragReorder(onReorder?: (p: OutlineReorder) => void) {
  const [drag, setDrag] = useState<DragState>(IDLE);
  // Synchronous mirror for the window pointerup commit handler.
  const dragRef = useRef(drag);
  dragRef.current = drag;

  const onDragHandlePointerDown = useCallback(
    (id: string, e: React.PointerEvent) => {
      if (e.button !== 0 || !onReorder) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      setDrag({ active: true, fromId: id, toId: null, position: 'before' });
    },
    [onReorder]
  );

  const onDragEnterRow = useCallback((id: string) => {
    setDrag((prev) => {
      if (!prev.active || prev.fromId === id || prev.toId === id) {
        return prev;
      }
      return { ...prev, toId: id };
    });
  }, []);

  const onDragMove = useCallback((id: string, e: React.PointerEvent) => {
    if (!dragRef.current.active) {
      return;
    }
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const y = e.clientY - rect.top;
    const position: DragPosition = y < rect.height / 2 ? 'before' : 'after';
    setDrag((prev) => {
      if (prev.toId === id && prev.position === position) {
        return prev;
      }
      return { ...prev, toId: id, position };
    });
  }, []);

  useEffect(() => {
    if (!drag.active) {
      return;
    }
    const commit = () => {
      const { fromId, toId, position } = dragRef.current;
      if (fromId && toId && onReorder && fromId !== toId) {
        const from = parseOutlineId(fromId);
        const to = parseOutlineId(toId);
        if (from.kind === 'block' && to.kind === 'block') {
          onReorder({ kind: 'block', fromIdx: from.blockIndex, toIdx: to.blockIndex, position });
        } else {
          const fromRegIdx =
            from.kind === 'register'
              ? from.registerIndex
              : from.kind === 'registerArray'
                ? from.arrayIndex
                : -1;
          const toRegIdx =
            to.kind === 'register'
              ? to.registerIndex
              : to.kind === 'registerArray'
                ? to.arrayIndex
                : -1;
          const fromBlock =
            from.kind === 'register' || from.kind === 'registerArray' ? from.blockIndex : -1;
          const toBlock =
            to.kind === 'register' || to.kind === 'registerArray' ? to.blockIndex : -1;
          if (fromRegIdx >= 0 && toRegIdx >= 0 && fromBlock === toBlock && fromBlock >= 0) {
            onReorder({
              kind: 'register',
              blockIndex: fromBlock,
              fromIdx: fromRegIdx,
              toIdx: toRegIdx,
              position,
            });
          }
        }
      }
      setDrag(IDLE);
    };
    const cancel = () => setDrag(IDLE);
    window.addEventListener('pointerup', commit);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('blur', cancel);
    return () => {
      window.removeEventListener('pointerup', commit);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('blur', cancel);
    };
  }, [drag.active, onReorder]);

  const getDragProps = useCallback(
    (id: string): OutlineDragProps => {
      const isDragging = drag.active && drag.fromId === id;
      return {
        dragHandle: onReorder ? (
          <span
            className="codicon codicon-gripper text-sm shrink-0 w-4 flex items-center justify-center opacity-0 group-hover:opacity-40 hover:!opacity-90 transition-opacity"
            style={{ cursor: 'grab' }}
            title="Drag to reorder"
            aria-label="Drag to reorder"
            onPointerDown={(e) => onDragHandlePointerDown(id, e)}
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
          />
        ) : null,
        onRowPointerMove: (e: React.PointerEvent) => onDragMove(id, e),
        onRowPointerEnter: () => onDragEnterRow(id),
        isDragging,
      };
    },
    [drag, onReorder, onDragHandlePointerDown, onDragMove, onDragEnterRow]
  );

  // Real sibling-group index of a parsed id, mirroring the commit's mapping
  // (array-register nodes are not reorderable, so they yield -1).
  const regIndexOf = (p: ReturnType<typeof parseOutlineId>): number =>
    p.kind === 'register' ? p.registerIndex : p.kind === 'registerArray' ? p.arrayIndex : -1;
  const blockIndexOf = (p: ReturnType<typeof parseOutlineId>): number =>
    p.kind === 'register' || p.kind === 'registerArray' ? p.blockIndex : -1;

  const previewMove = useMemo<OutlinePreviewMove | null>(() => {
    if (!drag.active || !drag.fromId || !drag.toId || drag.fromId === drag.toId) {
      return null;
    }
    const from = parseOutlineId(drag.fromId);
    const to = parseOutlineId(drag.toId);
    const after = drag.position === 'after';
    if (from.kind === 'block' && to.kind === 'block') {
      return { kind: 'block', fromIdx: from.blockIndex, toIdx: to.blockIndex, after };
    }
    const fromReg = regIndexOf(from);
    const toReg = regIndexOf(to);
    const fromBlock = blockIndexOf(from);
    const toBlock = blockIndexOf(to);
    if (fromReg >= 0 && toReg >= 0 && fromBlock >= 0 && fromBlock === toBlock) {
      return { kind: 'register', blockIndex: fromBlock, fromIdx: fromReg, toIdx: toReg, after };
    }
    return null;
  }, [drag]);

  return { getDragProps, dragActive: drag.active, previewMove };
}
