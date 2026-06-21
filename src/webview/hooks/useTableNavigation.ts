import { useEffect, useCallback } from 'react';

/**
 * Column key type for generic table navigation
 */
export type ColumnKey = string;

export interface ActiveCell<T extends ColumnKey = ColumnKey> {
  rowId: string | null;
  key: T;
}

/**
 * Props for the table navigation hook
 */
export interface UseTableNavigationProps<T extends ColumnKey> {
  /** Current active cell */
  activeCell: ActiveCell<T>;
  /** Callback to set active cell */
  setActiveCell: (cell: ActiveCell<T>) => void;
  /** List of stable row ids */
  rowIds: string[];
  /** Ordered list of column keys */
  columnOrder: T[];
  /** Container ref for the table */
  containerRef: React.RefObject<HTMLElement>;
  /** Optional: callback when edit is triggered (F2 or 'e') */
  onEdit?: (rowId: string, key: T) => void;
  /** Optional: callback when delete is triggered ('d' or Delete) */
  onDelete?: (rowId: string) => void;
  /** Optional: callback when move is triggered (Alt+Arrow) */
  onMove?: (rowId: string, delta: number) => void;
  /** Optional: callback when insert after is triggered ('o') */
  onInsertAfter?: () => void;
  /** Optional: callback when insert before is triggered ('O') */
  onInsertBefore?: () => void;
  /** Whether the table is currently active/focused */
  isActive: boolean;
  /** Optional row selector attribute name (default: data-row-id) */
  rowSelectorAttr?: string;
}

/**
 * Custom hook for managing keyboard navigation in tables
 * Supports:
 * - Arrow keys for navigation
 * - Vim keys (h/j/k/l) for navigation
 * - F2 or 'e' for editing
 * - 'd' or Delete for deletion
 * - Alt+Arrow for moving rows
 * - 'o' for insert after, 'O' for insert before
 */
export function useTableNavigation<T extends ColumnKey>({
  activeCell,
  setActiveCell,
  rowIds,
  columnOrder,
  containerRef,
  onEdit,
  onDelete,
  onMove,
  onInsertAfter,
  onInsertBefore,
  isActive,
  rowSelectorAttr = 'data-row-id',
}: UseTableNavigationProps<T>) {
  /**
   * Scroll a cell into view
   */
  const scrollToCell = useCallback(
    (rowId: string, key: T) => {
      window.setTimeout(() => {
        const row = document.querySelector(`tr[${rowSelectorAttr}="${rowId}"]`);
        row?.scrollIntoView({ block: 'nearest' });
        const cell = row?.querySelector(`td[data-col-key="${key}"]`) as HTMLElement | null;
        cell?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      }, 0);
    },
    [rowSelectorAttr]
  );

  /**
   * Handle keyboard events
   */
  useEffect(() => {
    if (!isActive) {
      return;
    }

    const onKeyDown = (e: KeyboardEvent) => {
      let keyLower = (e.key || '').toLowerCase();
      if (e.altKey && e.code) {
        if (e.code === 'KeyH') {
          keyLower = 'h';
        }
        if (e.code === 'KeyJ') {
          keyLower = 'j';
        }
        if (e.code === 'KeyK') {
          keyLower = 'k';
        }
        if (e.code === 'KeyL') {
          keyLower = 'l';
        }
      }
      const vimToArrow: Record<string, 'ArrowLeft' | 'ArrowDown' | 'ArrowUp' | 'ArrowRight'> = {
        h: 'ArrowLeft',
        j: 'ArrowDown',
        k: 'ArrowUp',
        l: 'ArrowRight',
      };

      const mappedArrow = vimToArrow[keyLower];
      const normalizedKey: string = mappedArrow ?? e.key;

      const isArrow =
        normalizedKey === 'ArrowUp' ||
        normalizedKey === 'ArrowDown' ||
        normalizedKey === 'ArrowLeft' ||
        normalizedKey === 'ArrowRight';
      const isEdit = normalizedKey === 'F2' || normalizedKey === 'Enter' || keyLower === 'e';
      const isDelete = keyLower === 'd' || e.key === 'Delete';
      const isInsertAfter = keyLower === 'o' && !e.shiftKey;
      const isInsertBefore = keyLower === 'o' && e.shiftKey;

      if (!isArrow && !isEdit && !isDelete && !isInsertAfter && !isInsertBefore) {
        return;
      }

      // Avoid hijacking common editor chords
      if (e.ctrlKey || e.metaKey) {
        return;
      }

      const activeEl = document.activeElement as HTMLElement | null;
      const isInContainer =
        !!containerRef.current &&
        !!activeEl &&
        (activeEl === containerRef.current || containerRef.current.contains(activeEl));
      if (!isInContainer) {
        return;
      }

      const target = e.target as HTMLElement | null;
      const isInDropdown = !!target?.closest('vscode-dropdown');
      const isTypingTarget = !!target?.closest(
        'input, textarea, select, [contenteditable="true"], vscode-text-field, vscode-text-area'
      );

      // Don't steal arrow keys while editing/typing
      if (isTypingTarget) {
        return;
      }
      // In dropdown, allow vim keys but not raw arrow keys
      if (isInDropdown && !keyLower.match(/^[hjkl]$/)) {
        return;
      }

      const currentId = activeCell.rowId ?? (rowIds.length > 0 ? rowIds[0] : null);
      if (!currentId) {
        if (isInsertAfter && onInsertAfter) {
          e.preventDefault();
          e.stopPropagation();
          onInsertAfter();
          return;
        }
        if (isInsertBefore && onInsertBefore) {
          e.preventDefault();
          e.stopPropagation();
          onInsertBefore();
          return;
        }
        return;
      }
      const currentRow = rowIds.indexOf(currentId);
      const currentKey: T = activeCell.key || columnOrder[0];

      // Handle edit action
      if (isEdit && onEdit) {
        if (currentRow < 0 || currentRow >= rowIds.length) {
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        onEdit(currentId, currentKey);
        return;
      }

      // Handle insert actions
      if (isInsertAfter && onInsertAfter) {
        e.preventDefault();
        e.stopPropagation();
        onInsertAfter();
        return;
      }

      if (isInsertBefore && onInsertBefore) {
        e.preventDefault();
        e.stopPropagation();
        onInsertBefore();
        return;
      }

      // Handle delete action
      if (isDelete && onDelete) {
        if (currentRow < 0 || currentRow >= rowIds.length) {
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        onDelete(currentId);
        return;
      }

      // Handle arrow navigation
      const isVertical = normalizedKey === 'ArrowUp' || normalizedKey === 'ArrowDown';
      const delta = normalizedKey === 'ArrowUp' || normalizedKey === 'ArrowLeft' ? -1 : 1;

      // Alt+Arrow moves rows
      if (e.altKey && isVertical && onMove) {
        const nextIdx = currentRow + delta;
        if (nextIdx < 0 || nextIdx >= rowIds.length) {
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        onMove(currentId, delta);
        // Keep focus on the MOVED field, not on the displaced neighbour.
        // After reconcileRowIds, currentId will be at nextIdx in the new rows.
        setActiveCell({ rowId: currentId, key: currentKey });
        scrollToCell(currentId, currentKey);
        return;
      }

      // Regular arrow navigation
      if (isVertical) {
        const nextIdx = currentRow + delta;
        if (nextIdx < 0 || nextIdx >= rowIds.length) {
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        const nextId = rowIds[nextIdx];
        setActiveCell({ rowId: nextId, key: currentKey });
        scrollToCell(nextId, currentKey);
      } else {
        // Horizontal navigation
        const currentIndex = columnOrder.indexOf(currentKey);
        const nextIndex = currentIndex + delta;
        if (nextIndex < 0 || nextIndex >= columnOrder.length) {
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        const nextKey = columnOrder[nextIndex];
        setActiveCell({ rowId: currentId, key: nextKey });
        scrollToCell(currentId, nextKey);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    isActive,
    activeCell,
    rowIds,
    columnOrder,
    containerRef,
    onEdit,
    onDelete,
    onMove,
    onInsertAfter,
    onInsertBefore,
    setActiveCell,
    scrollToCell,
    rowSelectorAttr,
  ]);

  return {
    scrollToCell,
  };
}
