import { useCallback } from 'react';
import type { NormalizedMemoryMap } from '../../domain/internal.types';
import type { Selection } from './useSelection';

type ResolvedSelection = {
  type: Selection['type'];
  object: unknown;
  breadcrumbs: string[];
};

export function useSelectionResolver(memoryMap: NormalizedMemoryMap | null) {
  return useCallback(
    (selection: Selection | null): ResolvedSelection | null => {
      if (!selection || !memoryMap) {
        return null;
      }

      if (selection.type === 'memoryMap') {
        return {
          type: 'memoryMap',
          object: memoryMap,
          breadcrumbs: [memoryMap.name || 'Memory Map'],
        };
      }

      const blockIndex = typeof selection.path[1] === 'number' ? selection.path[1] : null;
      if (blockIndex === null) {
        return null;
      }

      const block = memoryMap.addressBlocks?.[blockIndex];
      if (!block) {
        return null;
      }

      if (selection.type === 'block') {
        return {
          type: 'block',
          object: block,
          breadcrumbs: [memoryMap.name || 'Memory Map', block.name],
        };
      }

      const blockRegisters = block.registers ?? [];

      if (selection.type === 'array') {
        const registerIndex = typeof selection.path[3] === 'number' ? selection.path[3] : null;
        if (registerIndex === null) {
          return null;
        }
        const node = blockRegisters[registerIndex];
        if (node?.__kind === 'array') {
          return {
            type: 'array',
            object: node,
            breadcrumbs: [memoryMap.name || 'Memory Map', block.name, node.name],
          };
        }
        return null;
      }

      if (selection.type !== 'register') {
        return null;
      }

      if (selection.path.length === 4) {
        const registerIndex = typeof selection.path[3] === 'number' ? selection.path[3] : null;
        if (registerIndex === null) {
          return null;
        }
        const node = blockRegisters[registerIndex];
        if (!node || node.__kind === 'array') {
          return null;
        }
        return {
          type: 'register',
          object: node,
          breadcrumbs: [memoryMap.name || 'Memory Map', block.name, node.name],
        };
      }

      if (selection.path.length === 6) {
        const arrayIndex = typeof selection.path[3] === 'number' ? selection.path[3] : null;
        const nestedIndex = typeof selection.path[5] === 'number' ? selection.path[5] : null;
        if (arrayIndex === null || nestedIndex === null) {
          return null;
        }
        const node = blockRegisters[arrayIndex];
        if (node?.__kind !== 'array') {
          return null;
        }
        const register = node.registers?.[nestedIndex];
        if (!register) {
          return null;
        }
        return {
          type: 'register',
          object: register,
          breadcrumbs: [memoryMap.name || 'Memory Map', block.name, node.name, register.name],
        };
      }

      return null;
    },
    [memoryMap]
  );
}
