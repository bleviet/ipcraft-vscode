import { useEffect, useRef } from 'react';
import type { MutableRefObject } from 'react';
import type { Selection } from './useSelection';
import type { MemoryMap } from '../types/memoryMap';

interface SelectionLifecycleOptions {
  memoryMap: MemoryMap | null;
  selectionRef: MutableRefObject<Selection | null>;
  handleSelect: (selection: Selection, addToHistory?: boolean) => void;
  resolveFromSelection: (
    selection: Selection | null
  ) => { type: Selection['type']; object: unknown; breadcrumbs: string[] } | null;
}

export function useSelectionLifecycle({
  memoryMap,
  selectionRef,
  handleSelect,
  resolveFromSelection,
}: SelectionLifecycleOptions) {
  const didInitSelectionRef = useRef(false);

  useEffect(() => {
    if (!memoryMap) {
      return;
    }

    if (!didInitSelectionRef.current) {
      handleSelect(
        {
          id: 'root',
          type: 'memoryMap',
          object: memoryMap,
          breadcrumbs: [memoryMap.name || 'Memory Map'],
          path: [],
        },
        false
      );
      didInitSelectionRef.current = true;
      return;
    }

    const resolved = resolveFromSelection(selectionRef.current);
    if (resolved && selectionRef.current) {
      handleSelect(
        {
          ...selectionRef.current,
          type: resolved.type,
          object: resolved.object,
          breadcrumbs: resolved.breadcrumbs,
        },
        false
      );
    }
  }, [memoryMap, handleSelect, resolveFromSelection, selectionRef]);
}
