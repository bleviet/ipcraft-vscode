import { useCallback } from 'react';
import type { Dispatch, KeyboardEvent, SetStateAction } from 'react';
import type { NormalizedMemoryMap } from '../../../domain/internal.types';
import type { OutlineSelection } from './types';
import { parseOutlineId } from './outlineIds';

interface UseOutlineKeyboardOptions {
  editingId: string | null;
  selectedId: string | null;
  rootId: string;
  visibleSelections: OutlineSelection[];
  onSelect: (selection: OutlineSelection) => void;
  onRename?: (path: Array<string | number>, newName: string | number) => void;
  startEditing: (id: string, currentName: string) => void;
  memoryMap: NormalizedMemoryMap;
  setExpanded: Dispatch<SetStateAction<Set<string>>>;
  /** Insert/delete a register within a block or a register array's template (see OutlinePanel's onRegisterAction). */
  onRegisterAction?: (
    blockIndex: number,
    regIndex: number | undefined,
    action: 'insertBefore' | 'insertAfter' | 'delete',
    kind?: 'register' | 'flat-array' | 'array',
    parentRegIndex?: number
  ) => void;
}

/**
 * A selected top-level register/array node's YAML path is always
 * ['addressBlocks', blockIndex, 'registers', regIndex] — a plain sibling in
 * a block's register list.
 */
function topLevelRegisterRef(
  path: Array<string | number>
): { blockIndex: number; regIndex: number } | null {
  if (
    path.length === 4 &&
    path[0] === 'addressBlocks' &&
    path[2] === 'registers' &&
    typeof path[1] === 'number' &&
    typeof path[3] === 'number'
  ) {
    return { blockIndex: path[1], regIndex: path[3] };
  }
  return null;
}

/**
 * A selected register-array-template child's YAML path is always
 * ['addressBlocks', blockIndex, 'registers', arrayIndex, 'registers', childIndex]
 * — every array element shares this one template, so it's addressed the same
 * regardless of which element (TIMER[0].CTRL vs TIMER[3].CTRL) was clicked
 * through to reach it.
 */
function arrayTemplateRegisterRef(
  path: Array<string | number>
): { blockIndex: number; parentRegIndex: number; regIndex: number } | null {
  if (
    path.length === 6 &&
    path[0] === 'addressBlocks' &&
    path[2] === 'registers' &&
    path[4] === 'registers' &&
    typeof path[1] === 'number' &&
    typeof path[3] === 'number' &&
    typeof path[5] === 'number'
  ) {
    return { blockIndex: path[1], parentRegIndex: path[3], regIndex: path[5] };
  }
  return null;
}

function blockRef(path: Array<string | number>): { blockIndex: number } | null {
  if (path.length === 2 && path[0] === 'addressBlocks' && typeof path[1] === 'number') {
    return { blockIndex: path[1] };
  }
  return null;
}

function hasExpandableChildren(currentId: string, memoryMap: NormalizedMemoryMap): boolean {
  const parsed = parseOutlineId(currentId);

  if (
    parsed.kind === 'root' ||
    parsed.kind === 'arrayRegister' ||
    parsed.kind === 'registerArray'
  ) {
    return true;
  }

  if (parsed.kind === 'block') {
    const block = memoryMap.addressBlocks?.[parsed.blockIndex];
    return Boolean(Array.isArray(block?.registers) && block.registers.length > 0);
  }

  return false;
}

export function useOutlineKeyboard({
  editingId,
  selectedId,
  rootId,
  visibleSelections,
  onSelect,
  onRename,
  startEditing,
  memoryMap,
  setExpanded,
  onRegisterAction,
}: UseOutlineKeyboardOptions) {
  return useCallback(
    (e: KeyboardEvent) => {
      if (editingId) {
        return;
      }

      const keyLower = (e.key || '').toLowerCase();
      const isDown = e.key === 'ArrowDown' || keyLower === 'j';
      const isUp = e.key === 'ArrowUp' || keyLower === 'k';
      const isToggleExpand = e.key === ' ' || (e.key === 'Enter' && !e.shiftKey);
      const isFocusDetails =
        (e.key === 'Enter' && !isToggleExpand) || e.key === 'ArrowRight' || keyLower === 'l';
      const isRename = e.key === 'F2' || keyLower === 'e';
      // Register-list editing, relocated here from the block detail view's
      // now-removed register rail: 'o'/'O' insert a register below/above,
      // Shift+A/Shift+I insert a register array below/above, 'd'/Delete
      // deletes — all scoped to a selected top-level register/array node.
      const isInsertRegAfter = keyLower === 'o' && !e.shiftKey;
      const isInsertRegBefore = keyLower === 'o' && e.shiftKey;
      const isInsertArrayAfter = keyLower === 'a' && e.shiftKey;
      const isInsertArrayBefore = keyLower === 'i' && e.shiftKey;
      const isDeleteReg = e.key === 'Delete' || (keyLower === 'd' && !e.shiftKey);

      if (
        !isDown &&
        !isUp &&
        !isFocusDetails &&
        !isToggleExpand &&
        !isRename &&
        !isInsertRegAfter &&
        !isInsertRegBefore &&
        !isInsertArrayAfter &&
        !isInsertArrayBefore &&
        !isDeleteReg
      ) {
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) {
        return;
      }

      const currentId = selectedId ?? rootId;
      const currentIndex = Math.max(
        0,
        visibleSelections.findIndex((s) => s.id === currentId)
      );
      const currentSel = visibleSelections[currentIndex] ?? visibleSelections[0];
      if (!currentSel) {
        return;
      }

      if (
        onRegisterAction &&
        (isInsertRegAfter ||
          isInsertRegBefore ||
          isInsertArrayAfter ||
          isInsertArrayBefore ||
          isDeleteReg)
      ) {
        const regRef = topLevelRegisterRef(currentSel.path);
        if (regRef) {
          e.preventDefault();
          e.stopPropagation();
          if (isDeleteReg) {
            onRegisterAction(regRef.blockIndex, regRef.regIndex, 'delete');
          } else {
            const action =
              isInsertRegBefore || isInsertArrayBefore ? 'insertBefore' : 'insertAfter';
            const kind = isInsertArrayAfter || isInsertArrayBefore ? 'array' : 'register';
            onRegisterAction(regRef.blockIndex, regRef.regIndex, action, kind);
          }
          return;
        }

        // A register array's template has no sub-arrays, so only the plain
        // register insert/delete keys apply here — Shift+A/I are a no-op.
        const arrRegRef = arrayTemplateRegisterRef(currentSel.path);
        if (arrRegRef && (isInsertRegAfter || isInsertRegBefore || isDeleteReg)) {
          e.preventDefault();
          e.stopPropagation();
          if (isDeleteReg) {
            onRegisterAction(
              arrRegRef.blockIndex,
              arrRegRef.regIndex,
              'delete',
              undefined,
              arrRegRef.parentRegIndex
            );
          } else {
            onRegisterAction(
              arrRegRef.blockIndex,
              arrRegRef.regIndex,
              isInsertRegBefore ? 'insertBefore' : 'insertAfter',
              'register',
              arrRegRef.parentRegIndex
            );
          }
          return;
        }

        // A block with no registers yet has no register node to anchor
        // insertBefore/insertAfter off of — 'o' alone inserts its first
        // register (mirrors the removed rail's "Press o to add one" prompt).
        if (isInsertRegAfter) {
          const bRef = blockRef(currentSel.path);
          const registerCount = bRef
            ? (memoryMap.addressBlocks?.[bRef.blockIndex]?.registers?.length ?? 0)
            : -1;
          if (bRef && registerCount === 0) {
            e.preventDefault();
            e.stopPropagation();
            onRegisterAction(bRef.blockIndex, undefined, 'insertAfter', 'register');
            return;
          }
        }
      }
      // These keys are register-action-only; whether or not a valid target
      // was found above, they must never fall through to the arrow-key nav
      // below (e.g. 'o' is not "up").
      if (
        isInsertRegAfter ||
        isInsertRegBefore ||
        isInsertArrayAfter ||
        isInsertArrayBefore ||
        isDeleteReg
      ) {
        return;
      }

      if (isRename && onRename) {
        e.preventDefault();
        e.stopPropagation();
        const name = (currentSel.object as { name?: string })?.name ?? '';
        if (name) {
          startEditing(currentId, name);
        }
        return;
      }

      if (isToggleExpand) {
        e.preventDefault();
        e.stopPropagation();

        if (hasExpandableChildren(currentId, memoryMap)) {
          setExpanded((prev) => {
            const next = new Set(prev);
            if (next.has(currentId)) {
              next.delete(currentId);
            } else {
              next.add(currentId);
            }
            return next;
          });
        }
        return;
      }

      if (isFocusDetails) {
        e.preventDefault();
        e.stopPropagation();
        onSelect({
          ...currentSel,
          meta: { ...(currentSel.meta ?? {}), focusDetails: true },
        });
        return;
      }

      const nextIndex = isDown
        ? Math.min(visibleSelections.length - 1, currentIndex + 1)
        : Math.max(0, currentIndex - 1);
      const nextSel = visibleSelections[nextIndex];
      if (!nextSel) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      onSelect({
        ...nextSel,
        meta: { ...(nextSel.meta ?? {}), focusDetails: false },
      });
    },
    [
      editingId,
      memoryMap,
      onRegisterAction,
      onRename,
      onSelect,
      rootId,
      selectedId,
      setExpanded,
      startEditing,
      visibleSelections,
    ]
  );
}
