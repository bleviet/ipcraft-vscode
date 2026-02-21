import { MemoryMap, Register, RegisterArray } from '../../types/memoryMap';
import {
  arrayElementId,
  arrayElementRegisterId,
  arrayRegisterId,
  blockId,
  registerArrayId,
  registerId,
  ROOT_ID,
} from './outlineIds';
import { BlockNode as BlockModel, OutlineSelection, isArrayNode } from './types';

interface BuildVisibleSelectionsOptions {
  memoryMap: MemoryMap;
  memoryMapName: string;
  expanded: Set<string>;
  filteredBlocks: Array<{ block: BlockModel; index: number }>;
}

export function buildVisibleSelections({
  memoryMap,
  memoryMapName,
  expanded,
  filteredBlocks,
}: BuildVisibleSelectionsOptions): OutlineSelection[] {
  const items: OutlineSelection[] = [];

  items.push({
    id: ROOT_ID,
    type: 'memoryMap',
    object: memoryMap,
    breadcrumbs: [memoryMapName],
    path: [],
  });

  if (!expanded.has(ROOT_ID)) {
    return items;
  }

  filteredBlocks.forEach(({ block, index: blockIndex }) => {
    const blockNodeId = blockId(blockIndex);
    items.push({
      id: blockNodeId,
      type: 'block',
      object: block,
      breadcrumbs: [memoryMapName, block.name],
      path: ['addressBlocks', blockIndex],
    });

    if (!expanded.has(blockNodeId)) {
      return;
    }

    const regsAny = block.registers ?? [];
    regsAny.forEach((node: unknown, regIndex: number) => {
      if (isArrayNode(node)) {
        const arr = node;
        const arrNodeId = arrayRegisterId(blockIndex, regIndex);
        items.push({
          id: arrNodeId,
          type: 'array',
          object: arr,
          breadcrumbs: [memoryMapName, block.name, arr.name],
          path: ['addressBlocks', blockIndex, 'registers', regIndex],
        });

        if (!expanded.has(arrNodeId)) {
          return;
        }

        const start = (block.base_address ?? 0) + (arr.address_offset ?? 0);
        Array.from({ length: arr.count }).forEach((_, elementIndex) => {
          const elementNodeId = arrayElementId(blockIndex, regIndex, elementIndex);
          const elementBase = start + elementIndex * arr.stride;
          items.push({
            id: elementNodeId,
            type: 'array',
            object: {
              ...arr,
              __element_index: elementIndex,
              __element_base: elementBase,
            },
            breadcrumbs: [memoryMapName, block.name, `${arr.name}[${elementIndex}]`],
            path: ['addressBlocks', blockIndex, 'registers', regIndex],
          });

          (arr.registers ?? []).forEach((reg: Register, childIndex: number) => {
            const childNodeId = arrayElementRegisterId(
              blockIndex,
              regIndex,
              elementIndex,
              childIndex
            );
            const absolute = elementBase + (reg.address_offset ?? 0);
            items.push({
              id: childNodeId,
              type: 'register',
              object: reg,
              breadcrumbs: [memoryMapName, block.name, `${arr.name}[${elementIndex}]`, reg.name],
              path: ['addressBlocks', blockIndex, 'registers', regIndex, 'registers', childIndex],
              meta: {
                absoluteAddress: absolute,
                relativeOffset: reg.address_offset ?? 0,
              },
            });
          });
        });
        return;
      }

      const reg = node as Register;
      const regNodeId = registerId(blockIndex, regIndex);
      const absolute = (block.base_address ?? 0) + (reg.address_offset ?? 0);
      items.push({
        id: regNodeId,
        type: 'register',
        object: reg,
        breadcrumbs: [memoryMapName, memoryMap.address_blocks?.[blockIndex]?.name ?? '', reg.name],
        path: ['addressBlocks', blockIndex, 'registers', regIndex],
        meta: {
          absoluteAddress: absolute,
          relativeOffset: reg.address_offset ?? 0,
        },
      });
    });

    (block.register_arrays ?? []).forEach((arr: RegisterArray, arrayIndex: number) => {
      const arrNodeId = registerArrayId(blockIndex, arrayIndex);
      items.push({
        id: arrNodeId,
        type: 'array',
        object: arr,
        breadcrumbs: [memoryMapName, memoryMap.address_blocks?.[blockIndex]?.name ?? '', arr.name],
        path: ['addressBlocks', blockIndex, 'register_arrays', arrayIndex],
      });

      if (!expanded.has(arrNodeId) || !Array.isArray(arr.registers)) {
        return;
      }

      arr.registers.forEach((reg: Register, regIndex: number) => {
        const regNodeId = registerId(blockIndex, regIndex);
        const absolute = (block.base_address ?? 0) + (reg.address_offset ?? 0);
        items.push({
          id: regNodeId,
          type: 'register',
          object: reg,
          breadcrumbs: [
            memoryMapName,
            memoryMap.address_blocks?.[blockIndex]?.name ?? '',
            reg.name,
          ],
          path: ['addressBlocks', blockIndex, 'registers', regIndex],
          meta: {
            absoluteAddress: absolute,
            relativeOffset: reg.address_offset ?? 0,
          },
        });
      });
    });
  });

  return items;
}
