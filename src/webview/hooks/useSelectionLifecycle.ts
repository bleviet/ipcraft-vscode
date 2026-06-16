import { useEffect, useRef } from 'react';
import type { MutableRefObject } from 'react';
import type { Selection } from './useSelection';
import type { NormalizedMemoryMap } from '../../domain/internal.types';

interface SelectionLifecycleOptions {
  memoryMap: NormalizedMemoryMap | null;
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
      // Array elements carry ephemeral __element_index / __element_base metadata
      // that is not stored in the YAML path and therefore not restored by
      // resolveFromSelection. Re-attach it so DetailsPanel keeps rendering the
      // element view (e.g. DMA[0]) instead of falling back to the template view.
      const oldObj = selectionRef.current.object as Record<string, unknown> | null | undefined;
      const resolvedObject =
        selectionRef.current.type === 'array' && oldObj?.__element_index !== undefined
          ? {
              ...(resolved.object as Record<string, unknown>),
              __element_index: oldObj.__element_index,
              __element_base: oldObj.__element_base,
            }
          : resolved.object;
      handleSelect(
        {
          ...selectionRef.current,
          type: resolved.type,
          object: resolvedObject,
          breadcrumbs: resolved.breadcrumbs,
        },
        false
      );
    }
  }, [memoryMap, handleSelect, resolveFromSelection, selectionRef]);
}
