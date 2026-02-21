import { useCallback } from 'react';
import type { MutableRefObject } from 'react';
import type { MemoryMap } from '../types/memoryMap';
import type { Selection } from './useSelection';

interface DetailsNavigationOptions {
  memoryMap: MemoryMap | null;
  selectedObject: unknown;
  selectionRef: MutableRefObject<Selection | null>;
  handleSelect: (selection: Selection, addToHistory?: boolean) => void;
}

export function useDetailsNavigation({
  memoryMap,
  selectedObject,
  selectionRef,
  handleSelect,
}: DetailsNavigationOptions) {
  const navigateToRegister = useCallback(
    (regIndex: number) => {
      if (!memoryMap || !selectionRef.current) {
        return;
      }

      if (selectionRef.current.type === 'block') {
        const currentPath = selectionRef.current.path || [];
        const block = selectedObject as Record<string, unknown>;
        const registers = (block.registers as unknown[]) || [];
        const reg = registers[regIndex] as Record<string, unknown>;
        if (!reg) {
          return;
        }

        const isArray = reg.__kind === 'array';
        const newPath = [...currentPath, 'registers', regIndex];
        const idSuffix = isArray ? `-arrreg-${regIndex}` : `-reg-${regIndex}`;

        handleSelect({
          id: `${selectionRef.current.id}${idSuffix}`,
          type: isArray ? 'array' : 'register',
          object: reg,
          breadcrumbs: [
            ...(selectionRef.current.breadcrumbs || []),
            String(reg.name ?? `Register ${regIndex}`),
          ],
          path: newPath,
        });
        return;
      }

      if (selectionRef.current.type === 'array') {
        const arrayNode = selectedObject as Record<string, unknown>;
        const registers = (arrayNode.registers as unknown[]) || [];
        const reg = registers[regIndex] as Record<string, unknown>;
        if (!reg) {
          return;
        }

        const newPath = [...(selectionRef.current.path || []), 'registers', regIndex];
        const id = `${selectionRef.current.id}-reg-${regIndex}`;
        const elementBase = (arrayNode.__element_base as number) ?? 0;
        const absoluteAddr = elementBase + ((reg.address_offset as number) ?? 0);

        handleSelect({
          id,
          type: 'register',
          object: reg,
          breadcrumbs: [
            ...(selectionRef.current.breadcrumbs || []),
            String(reg.name ?? `Register ${regIndex}`),
          ],
          path: newPath,
          meta: {
            absoluteAddress: absoluteAddr,
            relativeOffset: (reg.address_offset as number) ?? 0,
          },
        });
      }
    },
    [handleSelect, memoryMap, selectedObject, selectionRef]
  );

  const navigateToBlock = useCallback(
    (blockIndex: number) => {
      if (!memoryMap?.address_blocks) {
        return;
      }

      const block = memoryMap.address_blocks[blockIndex];
      if (!block) {
        return;
      }

      handleSelect({
        id: `block-${blockIndex}`,
        type: 'block',
        object: block,
        breadcrumbs: [memoryMap.name || 'Memory Map', block.name || `Block ${blockIndex}`],
        path: ['addressBlocks', blockIndex],
      });
    },
    [handleSelect, memoryMap]
  );

  return {
    navigateToRegister,
    navigateToBlock,
  };
}
