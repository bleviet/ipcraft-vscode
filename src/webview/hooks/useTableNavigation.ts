import { useEffect, useCallback } from 'react';

/**
 * Column key type for generic table navigation
 */
export type ColumnKey = string;

/**
 * Active cell in the table
 */
export interface ActiveCell<T extends ColumnKey = ColumnKey> {
  rowIndex: number;
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
  /** Total number of rows */
  rowCount: number;
  /** Ordered list of column keys */
  columnOrder: T[];
  /** Container ref for the table */
  containerRef: React.RefObject<HTMLElement>;
  /** Optional: callback when edit is triggered (F2 or 'e') */
  onEdit?: (rowIndex: number, key: T) => void;
  /** Optional: callback when delete is triggered ('d' or Delete) */
  onDelete?: (rowIndex: number) => void;
  /** Optional: callback when move is triggered (Alt+Arrow) */
  onMove?: (fromIndex: number, delta: number) => void;
  /** Optional: callback when insert after is triggered ('o') */
  onInsertAfter?: () => void;
  /** Optional: callback when insert before is triggered ('O') */
  onInsertBefore?: () => void;
  /** Whether the table is currently active/focused */
  isActive: boolean;
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
  rowCount,
  columnOrder,
  containerRef,
  onEdit,
  onDelete,
  onMove,
  onInsertAfter,
  onInsertBefore,
  isActive,
}: UseTableNavigationProps<T>) {
  /**
   * Scroll a cell into view
   */
  const scrollToCell = useCallback((rowIndex: number, key: T) => {
    window.setTimeout(() => {
      const row = document.querySelector(`tr[data-row-idx="${rowIndex}"]`);
      row?.scrollIntoView({ block: rowIndex === 0 ? 'center' : 'nearest' });
      const cell = row?.querySelector(`td[data-col-key="${key}"]`) as HTMLElement | null;
      cell?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }, 0);
  }, []);

  /**
   * Handle keyboard events
   */
  useEffect(() => {
    if (!isActive) {
      return;
    }

    const onKeyDown = (e: KeyboardEvent) => {
      const keyLower = (e.key || '').toLowerCase();
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
      const isEdit = normalizedKey === 'F2' || keyLower === 'e';
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

      const currentRow = activeCell.rowIndex >= 0 ? activeCell.rowIndex : 0;
      const currentKey: T = activeCell.key || columnOrder[0];

      // Handle edit action
      if (isEdit && onEdit) {
        if (currentRow < 0 || currentRow >= rowCount) {
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        onEdit(currentRow, currentKey);
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
        if (currentRow < 0 || currentRow >= rowCount) {
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        onDelete(currentRow);
        return;
      }

      // Handle arrow navigation
      const isVertical = normalizedKey === 'ArrowUp' || normalizedKey === 'ArrowDown';
      const delta = normalizedKey === 'ArrowUp' || normalizedKey === 'ArrowLeft' ? -1 : 1;

      // Alt+Arrow moves rows
      if (e.altKey && isVertical && onMove) {
        const next = currentRow + delta;
        if (next < 0 || next >= rowCount) {
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        onMove(currentRow, delta);
        setActiveCell({ rowIndex: next, key: currentKey });
        scrollToCell(next, currentKey);
        return;
      }

      // Regular arrow navigation
      if (isVertical) {
        const nextRow = currentRow + delta;
        if (nextRow < 0 || nextRow >= rowCount) {
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        setActiveCell({ rowIndex: nextRow, key: currentKey });
        scrollToCell(nextRow, currentKey);
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
        setActiveCell({ rowIndex: currentRow, key: nextKey });
        scrollToCell(currentRow, nextKey);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    isActive,
    activeCell,
    rowCount,
    columnOrder,
    containerRef,
    onEdit,
    onDelete,
    onMove,
    onInsertAfter,
    onInsertBefore,
    setActiveCell,
    scrollToCell,
  ]);

  return {
    scrollToCell,
  };
}
