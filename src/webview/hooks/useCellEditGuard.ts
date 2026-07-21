import { useCallback, useEffect, useRef } from 'react';
import type { YamlUpdateHandler } from '../types/editor';

export interface UseCellEditGuardOptions<T> {
  rows: T[];
  rowsPath: (string | number)[];
  onUpdate: YamlUpdateHandler;
  containerRef: React.RefObject<HTMLElement>;
  isActive?: boolean;
  onAfterRevert?: (snapshot: T[]) => void;
}

/**
 * Generic Enter/ESC guard for inline-editing tables.
 *
 * - Enter: blurs the active input and returns focus to the container (commit via onBlur).
 * - ESC:   reverts the full rows array to the snapshot taken at the last captureEditSnapshot()
 *          call, sets cancelEditRef so onBlur handlers can skip their commit, then returns
 *          focus to the container.
 *
 * Callers must:
 *   1. Call captureEditSnapshot() in the onFocus handler of every editable cell input.
 *   2. Check cancelEditRef.current in any onBlur handler before committing.
 */
export function useCellEditGuard<T>({
  rows,
  rowsPath,
  onUpdate,
  containerRef,
  isActive = true,
  onAfterRevert,
}: UseCellEditGuardOptions<T>): {
  cancelEditRef: React.MutableRefObject<boolean>;
  captureEditSnapshot: () => void;
} {
  const rowsRef = useRef(rows);
  const onUpdateRef = useRef(onUpdate);
  const snapshotRef = useRef<T[]>([]);
  const cancelEditRef = useRef(false);
  const onAfterRevertRef = useRef(onAfterRevert);

  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);
  useEffect(() => {
    onUpdateRef.current = onUpdate;
  }, [onUpdate]);
  useEffect(() => {
    onAfterRevertRef.current = onAfterRevert;
  }, [onAfterRevert]);

  const captureEditSnapshot = useCallback(() => {
    snapshotRef.current = [...rowsRef.current];
  }, []);

  useEffect(() => {
    if (!isActive) {
      return;
    }
    const onKeyDown = (e: KeyboardEvent) => {
      const isEsc = e.key === 'Escape';
      const isEnter = e.key === 'Enter';
      if (!isEsc && !isEnter) {
        return;
      }

      const activeEl = document.activeElement as HTMLElement | null;
      if (!activeEl) {
        return;
      }

      // Only act when a child input (not the container itself) is focused
      const inContainer =
        !!containerRef.current &&
        containerRef.current.contains(activeEl) &&
        activeEl !== containerRef.current;
      if (!inContainer) {
        return;
      }

      // Let Enter insert newlines in multi-line text areas
      const isTextareaTarget = activeEl instanceof HTMLTextAreaElement;
      if (isEnter && isTextareaTarget) {
        return;
      }

      // Let native selects handle their own Enter and option selection.
      const isDropdownTarget = activeEl instanceof HTMLSelectElement;
      if (isEnter && isDropdownTarget) {
        return;
      }

      e.preventDefault();
      e.stopPropagation();

      if (isEsc) {
        cancelEditRef.current = true;

        const snapshot = snapshotRef.current;
        if (snapshot.length > 0) {
          onUpdateRef.current(rowsPath, snapshot);
        }

        onAfterRevertRef.current?.(snapshot);

        try {
          activeEl.blur?.();
        } catch {
          // ignore
        }
        window.setTimeout(() => {
          containerRef.current?.focus();
        }, 0);
        window.setTimeout(() => {
          cancelEditRef.current = false;
        }, 50);
      } else {
        // Enter: commit via onBlur, return focus to table
        try {
          activeEl.blur?.();
        } catch {
          // ignore
        }
        window.setTimeout(() => {
          containerRef.current?.focus();
        }, 0);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isActive, rowsPath, containerRef]);

  return { cancelEditRef, captureEditSnapshot };
}
