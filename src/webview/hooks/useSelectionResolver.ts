import { useCallback } from 'react';
import type { MemoryMap } from '../types/memoryMap';
import type { Selection } from './useSelection';
import type { NormalizedRegister, NormalizedRegisterArray } from '../services/DataNormalizer';

type ResolvedSelection = {
  type: Selection['type'];
  object: unknown;
  breadcrumbs: string[];
};

export function useSelectionResolver(memoryMap: MemoryMap | null) {
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

      const block = memoryMap.address_blocks?.[blockIndex];
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

      const blockRegisters = ((block as { registers?: unknown[] }).registers ?? []) as Array<
        NormalizedRegister | NormalizedRegisterArray
      >;

      if (selection.type === 'array') {
        const registerIndex = typeof selection.path[3] === 'number' ? selection.path[3] : null;
        if (registerIndex === null) {
          return null;
        }
        const node = blockRegisters[registerIndex];
        if (node && (node as { __kind?: string }).__kind === 'array') {
          const registerArray = node as NormalizedRegisterArray;
          return {
            type: 'array',
            object: registerArray,
            breadcrumbs: [memoryMap.name || 'Memory Map', block.name, registerArray.name],
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
        if (!node || (node as { __kind?: string }).__kind === 'array') {
          return null;
        }
        const register = node as NormalizedRegister;
        return {
          type: 'register',
          object: register,
          breadcrumbs: [memoryMap.name || 'Memory Map', block.name, register.name],
        };
      }

      if (selection.path.length === 6) {
        const arrayIndex = typeof selection.path[3] === 'number' ? selection.path[3] : null;
        const nestedIndex = typeof selection.path[5] === 'number' ? selection.path[5] : null;
        if (arrayIndex === null || nestedIndex === null) {
          return null;
        }
        const node = blockRegisters[arrayIndex];
        if (!node || (node as { __kind?: string }).__kind !== 'array') {
          return null;
        }
        const registerArray = node as NormalizedRegisterArray;
        const register = registerArray.registers?.[nestedIndex];
        if (!register) {
          return null;
        }
        return {
          type: 'register',
          object: register,
          breadcrumbs: [
            memoryMap.name || 'Memory Map',
            block.name,
            registerArray.name,
            register.name,
          ],
        };
      }

      return null;
    },
    [memoryMap]
  );
}
