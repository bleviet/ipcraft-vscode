import { useCallback } from 'react';
import type { Dispatch, KeyboardEvent, SetStateAction } from 'react';
import type { MemoryMap } from '../../types/memoryMap';
import type { OutlineSelection } from './types';
import { parseOutlineId } from './outlineIds';

interface UseOutlineKeyboardOptions {
  editingId: string | null;
  selectedId: string | null;
  rootId: string;
  visibleSelections: OutlineSelection[];
  onSelect: (selection: OutlineSelection) => void;
  onRename?: (path: Array<string | number>, newName: string) => void;
  startEditing: (id: string, currentName: string) => void;
  memoryMap: MemoryMap;
  setExpanded: Dispatch<SetStateAction<Set<string>>>;
}

function hasExpandableChildren(currentId: string, memoryMap: MemoryMap): boolean {
  const parsed = parseOutlineId(currentId);

  if (
    parsed.kind === 'root' ||
    parsed.kind === 'arrayRegister' ||
    parsed.kind === 'registerArray'
  ) {
    return true;
  }

  if (parsed.kind === 'block') {
    const block = memoryMap.address_blocks?.[parsed.blockIndex];
    const hasRegisters = Array.isArray(block?.registers) && block.registers.length > 0;
    const hasArrays = Array.isArray(block?.register_arrays) && block.register_arrays.length > 0;
    return Boolean(hasRegisters || hasArrays);
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

      if (!isDown && !isUp && !isFocusDetails && !isToggleExpand && !isRename) {
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
