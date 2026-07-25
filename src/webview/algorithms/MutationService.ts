/**
 * MutationService
 *
 * Stateless mutation functions for memory-mapped register spaces.
 * Every function:
 *   1. Performs the structural mutation (splice, insert, remove)
 *   2. Calls `recomputeFullLayout()` to fix all offsets/ranges
 *   3. Returns the updated map plus any validation errors
 *
 * All functions are pure -- no side effects, no React state, no DOM.
 */

import {
  recomputeAddressLayout,
  recomputeFullLayout,
  type LayoutMemoryMap,
  type LayoutBlock,
  type LayoutRegister,
  type LayoutField,
  type LayoutError,
} from './LayoutEngine';
import { formatBitsRange } from '../utils/BitFieldUtils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Layer = 'block' | 'register' | 'field';
export type InsertMode = 'before' | 'after';

/** Path to a parent container in the memory map hierarchy. */
export interface ParentPath {
  blockIndex: number;
  registerIndex?: number;
}

/** Result of a mutation operation. */
export interface MutationResult {
  memoryMap: LayoutMemoryMap;
  errors: LayoutError[];
  /** Index of the newly inserted/relocated element in its parent array. -1 on error. */
  newIndex: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Deep-clone for the unused relocateElement helper.
 *
 * Production structural edits use the path-specific copy-on-write updates below.
 */
function cloneForRelocation(map: LayoutMemoryMap): LayoutMemoryMap {
  return JSON.parse(JSON.stringify(map)) as LayoutMemoryMap;
}

/** Get blocks array from a memory map. */
function getBlocks(map: LayoutMemoryMap): LayoutBlock[] {
  return map.addressBlocks ?? [];
}

/** Return a map with one block replaced, without changing the input map. */
function replaceBlock(
  map: LayoutMemoryMap,
  blockIndex: number,
  block: LayoutBlock
): LayoutMemoryMap {
  const blocks = [...getBlocks(map)];
  blocks[blockIndex] = block;
  return { ...map, addressBlocks: blocks };
}

/** Return a map with a replacement address-block array, without changing the input map. */
function replaceBlocks(map: LayoutMemoryMap, blocks: LayoutBlock[]): LayoutMemoryMap {
  return { ...map, addressBlocks: blocks };
}

/** Return a block with its top-level or nested registers replaced. */
function replaceRegistersInBlock(
  block: LayoutBlock,
  blockRegisters: LayoutRegister[],
  parentIndex: number | undefined,
  registers: LayoutRegister[]
): LayoutBlock {
  if (parentIndex === undefined) {
    return { ...block, registers };
  }
  return {
    ...block,
    registers: blockRegisters.map((register, index) =>
      index === parentIndex ? { ...register, registers } : register
    ),
  };
}

/** Return a block with one register's fields replaced. */
function replaceFieldsInBlock(
  block: LayoutBlock,
  blockRegisters: LayoutRegister[],
  registerIndex: number,
  fields: LayoutField[]
): LayoutBlock {
  return {
    ...block,
    registers: blockRegisters.map((register, index) =>
      index === registerIndex ? { ...register, fields } : register
    ),
  };
}

import { generateUniqueName } from '../utils/naming';

/** Compute the next sequential name of the form `<prefix><N+1>`. */
function nextSequentialName(items: { name?: string }[], prefix: string): string {
  return generateUniqueName(items, prefix);
}

/** Create a default 1-bit field. */
function defaultField(name: string): LayoutField {
  return {
    name,
    bits: formatBitsRange(0, 0),
    offset: 0,
    width: 1,
    bitRange: [0, 0] as [number, number],
    access: 'read-write',
    resetValue: 0,
    description: '',
  };
}

/** Create a default register. */
function defaultRegister(name: string): LayoutRegister {
  return {
    name,
    offset: 0,
    access: 'read-write',
    description: '',
  };
}

/** Create a default flat array. */
function defaultFlatArray(name: string): LayoutRegister {
  return {
    name,
    offset: 0,
    count: 2,
    stride: 4,
    description: '',
  };
}

/** Create a default nested array. */
function defaultNestedArray(name: string): LayoutRegister {
  return {
    name,
    offset: 0,
    count: 2,
    stride: 4,
    description: '',
    registers: [
      {
        name: 'reg0',
        offset: 0,
        description: '',
        fields: [{ name: 'data', bits: '[31:0]', access: 'read-write', description: '' }],
      },
    ],
  };
}

/** Create a default block with one register. */
function defaultBlock(name: string): LayoutBlock {
  return {
    name,
    baseAddress: 0,
    usage: 'register',
    description: '',
    registers: [defaultRegister('reg0')],
  };
}

/** Create a default RAM/memory block. */
function defaultRamBlock(name: string): LayoutBlock {
  return {
    name,
    baseAddress: 0,
    usage: 'memory',
    range: 1024,
    defaultRegWidth: 32,
    access: 'read-write',
    description: '',
  };
}

// ---------------------------------------------------------------------------
// insertElement
// ---------------------------------------------------------------------------

/**
 * Insert a default element before or after the target index.
 *
 * @param memoryMap   The current memory map (not mutated).
 * @param layer       Which layer to insert into.
 * @param mode        'before' or 'after' the target.
 * @param targetIndex Index of the reference element. -1 means end.
 * @param parentPath  Path to the parent container (required for 'register' and 'field' layers).
 * @param kind        The kind of element to insert ('register', 'flat-array', 'array', 'block', or 'ram').
 */
export function insertElement(
  memoryMap: LayoutMemoryMap,
  layer: Layer,
  mode: InsertMode,
  targetIndex: number,
  parentPath?: ParentPath,
  kind: 'register' | 'flat-array' | 'array' | 'block' | 'ram' = 'register'
): MutationResult {
  const blocks = getBlocks(memoryMap);

  if (layer === 'block') {
    const prefix = kind === 'ram' ? 'ram' : 'block';
    const name = nextSequentialName(blocks, prefix);
    const insertIdx = computeInsertIndex(targetIndex, blocks.length, mode);
    const newBlock = kind === 'ram' ? defaultRamBlock(name) : defaultBlock(name);
    const updatedBlocks = [...blocks];
    updatedBlocks.splice(insertIdx, 0, newBlock);

    const { data, errors } = recomputeAddressLayout(replaceBlocks(memoryMap, updatedBlocks));
    const finalBlocks = getBlocks(data);
    const newIndex = finalBlocks.findIndex((b) => b.name === name);
    return { memoryMap: data, errors, newIndex };
  }

  if (layer === 'register') {
    const bi = parentPath?.blockIndex ?? 0;
    const block = blocks[bi];
    if (!block) {
      return {
        memoryMap,
        errors: [
          {
            layer: 'register',
            parentPath: `blocks[${bi}]`,
            message: 'Block not found',
            severity: 'error',
          },
        ],
        newIndex: -1,
      };
    }

    const blockRegisters = block.registers ?? [];
    let regs: LayoutRegister[];
    let parentArray: LayoutRegister | undefined;
    if (parentPath?.registerIndex !== undefined) {
      parentArray = blockRegisters[parentPath.registerIndex];
      if (!parentArray) {
        return {
          memoryMap,
          errors: [
            {
              layer: 'register',
              parentPath: `blocks[${bi}].registers[${parentPath.registerIndex}]`,
              message: 'Parent register array not found',
              severity: 'error',
            },
          ],
          newIndex: -1,
        };
      }
      regs = parentArray.registers ?? [];
    } else {
      regs = blockRegisters;
    }

    const prefix = kind === 'register' ? 'reg' : kind === 'flat-array' ? 'regArray' : 'array';
    const name = nextSequentialName(regs, prefix);
    const insertIdx = computeInsertIndex(targetIndex, regs.length, mode);

    let newReg: LayoutRegister;
    if (kind === 'array') {
      newReg = defaultNestedArray(name);
    } else if (kind === 'flat-array') {
      newReg = defaultFlatArray(name);
    } else {
      newReg = defaultRegister(name);
    }

    const updatedRegs = [...regs];
    updatedRegs.splice(insertIdx, 0, newReg);
    const updatedBlock = replaceRegistersInBlock(
      block,
      blockRegisters,
      parentArray ? parentPath?.registerIndex : undefined,
      updatedRegs
    );

    const { data, errors } = recomputeAddressLayout(replaceBlock(memoryMap, bi, updatedBlock));
    let finalRegs: LayoutRegister[];
    if (parentPath?.registerIndex !== undefined) {
      finalRegs = (getBlocks(data)[bi]?.registers ?? [])[parentPath.registerIndex]?.registers ?? [];
    } else {
      finalRegs = getBlocks(data)[bi]?.registers ?? [];
    }
    const newIndex = finalRegs.findIndex((r) => r.name === name);
    return { memoryMap: data, errors, newIndex };
  }

  if (layer === 'field') {
    const bi = parentPath?.blockIndex ?? 0;
    const ri = parentPath?.registerIndex ?? 0;
    const block = blocks[bi];
    if (!block) {
      return {
        memoryMap,
        errors: [
          {
            layer: 'field',
            parentPath: `blocks[${bi}]`,
            message: 'Block not found',
            severity: 'error',
          },
        ],
        newIndex: -1,
      };
    }
    const blockRegisters = block.registers ?? [];
    const reg = blockRegisters[ri];
    if (!reg) {
      return {
        memoryMap,
        errors: [
          {
            layer: 'field',
            parentPath: `blocks[${bi}].registers[${ri}]`,
            message: 'Register not found',
            severity: 'error',
          },
        ],
        newIndex: -1,
      };
    }
    const fields = reg.fields ?? [];
    const name = nextSequentialName(fields, 'field');
    const insertIdx = computeInsertIndex(targetIndex, fields.length, mode);
    const updatedFields = [...fields];
    updatedFields.splice(insertIdx, 0, defaultField(name));
    const updatedBlock = replaceFieldsInBlock(block, blockRegisters, ri, updatedFields);

    const { data, errors } = recomputeFullLayout(replaceBlock(memoryMap, bi, updatedBlock));
    const finalFields = (getBlocks(data)[bi]?.registers ?? [])[ri]?.fields ?? [];
    const newIndex = finalFields.findIndex((f) => f.name === name);
    return { memoryMap: data, errors, newIndex };
  }

  return { memoryMap, errors: [], newIndex: -1 };
}

// ---------------------------------------------------------------------------
// deleteElement
// ---------------------------------------------------------------------------

/**
 * Delete an element at the target index.
 *
 * @param memoryMap   The current memory map (not mutated).
 * @param layer       Which layer to delete from.
 * @param targetIndex Index of the element to delete.
 * @param parentPath  Path to the parent container (required for 'register' and 'field' layers).
 */
export function deleteElement(
  memoryMap: LayoutMemoryMap,
  layer: Layer,
  targetIndex: number,
  parentPath?: ParentPath
): MutationResult {
  const blocks = getBlocks(memoryMap);

  if (layer === 'block') {
    if (targetIndex < 0 || targetIndex >= blocks.length) {
      return {
        memoryMap,
        errors: [
          { layer: 'block', parentPath: '', message: 'Invalid block index', severity: 'error' },
        ],
        newIndex: -1,
      };
    }
    const updatedBlocks = [...blocks];
    updatedBlocks.splice(targetIndex, 1);
    const { data, errors } = recomputeAddressLayout(replaceBlocks(memoryMap, updatedBlocks));
    return { memoryMap: data, errors, newIndex: Math.min(targetIndex, getBlocks(data).length - 1) };
  }

  if (layer === 'register') {
    const bi = parentPath?.blockIndex ?? 0;
    const block = blocks[bi];
    if (!block) {
      return {
        memoryMap,
        errors: [
          {
            layer: 'register',
            parentPath: `blocks[${bi}]`,
            message: 'Block not found',
            severity: 'error',
          },
        ],
        newIndex: -1,
      };
    }

    const blockRegisters = block.registers ?? [];
    let regs: LayoutRegister[];
    let parentArray: LayoutRegister | undefined;
    if (parentPath?.registerIndex !== undefined) {
      parentArray = blockRegisters[parentPath.registerIndex];
      if (!parentArray) {
        return {
          memoryMap,
          errors: [
            {
              layer: 'register',
              parentPath: `blocks[${bi}].registers[${parentPath.registerIndex}]`,
              message: 'Parent register array not found',
              severity: 'error',
            },
          ],
          newIndex: -1,
        };
      }
      regs = parentArray.registers ?? [];
    } else {
      regs = blockRegisters;
    }

    if (targetIndex < 0 || targetIndex >= regs.length) {
      return {
        memoryMap,
        errors: [
          {
            layer: 'register',
            parentPath:
              parentPath?.registerIndex !== undefined
                ? `blocks[${bi}].registers[${parentPath.registerIndex}]`
                : `blocks[${bi}]`,
            message: 'Invalid register index',
            severity: 'error',
          },
        ],
        newIndex: -1,
      };
    }
    const updatedRegs = [...regs];
    updatedRegs.splice(targetIndex, 1);
    const updatedBlock = replaceRegistersInBlock(
      block,
      blockRegisters,
      parentArray ? parentPath?.registerIndex : undefined,
      updatedRegs
    );
    const { data, errors } = recomputeAddressLayout(replaceBlock(memoryMap, bi, updatedBlock));
    let finalRegs: LayoutRegister[];
    if (parentPath?.registerIndex !== undefined) {
      finalRegs = (getBlocks(data)[bi]?.registers ?? [])[parentPath.registerIndex]?.registers ?? [];
    } else {
      finalRegs = getBlocks(data)[bi]?.registers ?? [];
    }
    return { memoryMap: data, errors, newIndex: Math.min(targetIndex, finalRegs.length - 1) };
  }

  if (layer === 'field') {
    const bi = parentPath?.blockIndex ?? 0;
    const ri = parentPath?.registerIndex ?? 0;
    const block = blocks[bi];
    if (!block) {
      return {
        memoryMap,
        errors: [
          {
            layer: 'field',
            parentPath: `blocks[${bi}]`,
            message: 'Block not found',
            severity: 'error',
          },
        ],
        newIndex: -1,
      };
    }
    const blockRegisters = block.registers ?? [];
    const reg = blockRegisters[ri];
    if (!reg) {
      return {
        memoryMap,
        errors: [
          {
            layer: 'field',
            parentPath: `blocks[${bi}].registers[${ri}]`,
            message: 'Register not found',
            severity: 'error',
          },
        ],
        newIndex: -1,
      };
    }
    const fields = reg.fields ?? [];
    if (targetIndex < 0 || targetIndex >= fields.length) {
      return {
        memoryMap,
        errors: [
          {
            layer: 'field',
            parentPath: `blocks[${bi}].registers[${ri}]`,
            message: 'Invalid field index',
            severity: 'error',
          },
        ],
        newIndex: -1,
      };
    }
    const updatedFields = [...fields];
    updatedFields.splice(targetIndex, 1);
    const updatedBlock = replaceFieldsInBlock(block, blockRegisters, ri, updatedFields);
    const { data, errors } = recomputeFullLayout(replaceBlock(memoryMap, bi, updatedBlock));
    const finalFields = (getBlocks(data)[bi]?.registers ?? [])[ri]?.fields ?? [];
    return { memoryMap: data, errors, newIndex: Math.min(targetIndex, finalFields.length - 1) };
  }

  return { memoryMap, errors: [], newIndex: -1 };
}

// ---------------------------------------------------------------------------
// relocateElement
// ---------------------------------------------------------------------------

/**
 * Relocate an element from one position to another, possibly across parents.
 *
 * @param memoryMap        The current memory map (not mutated).
 * @param layer            Which layer the element belongs to.
 * @param sourceIndex      Index of the element in its source parent.
 * @param sourceParentPath Path to the source parent container.
 * @param targetParentPath Path to the target parent container.
 * @param targetIndex      Desired index in the target parent.
 */
export function relocateElement(
  memoryMap: LayoutMemoryMap,
  layer: Layer,
  sourceIndex: number,
  sourceParentPath: ParentPath,
  targetParentPath: ParentPath,
  targetIndex: number
): MutationResult {
  const map = cloneForRelocation(memoryMap);
  const blocks = getBlocks(map);

  if (layer === 'block') {
    if (sourceIndex < 0 || sourceIndex >= blocks.length) {
      return {
        memoryMap,
        errors: [
          { layer, parentPath: '', message: 'Invalid source block index', severity: 'error' },
        ],
        newIndex: -1,
      };
    }
    const [removed] = blocks.splice(sourceIndex, 1);
    const clampedTarget = Math.max(0, Math.min(targetIndex, blocks.length));
    blocks.splice(clampedTarget, 0, removed);

    const { data, errors } = recomputeAddressLayout(map);
    return { memoryMap: data, errors, newIndex: clampedTarget };
  }

  if (layer === 'register') {
    const srcBi = sourceParentPath.blockIndex;
    const tgtBi = targetParentPath.blockIndex;
    const srcBlock = blocks[srcBi];
    const tgtBlock = blocks[tgtBi];

    if (!srcBlock || !tgtBlock) {
      return {
        memoryMap,
        errors: [{ layer, parentPath: '', message: 'Block not found', severity: 'error' }],
        newIndex: -1,
      };
    }

    const srcRegs = srcBlock.registers ?? [];
    if (sourceIndex < 0 || sourceIndex >= srcRegs.length) {
      return {
        memoryMap,
        errors: [
          {
            layer,
            parentPath: `blocks[${srcBi}]`,
            message: 'Invalid source register index',
            severity: 'error',
          },
        ],
        newIndex: -1,
      };
    }

    const [removed] = srcRegs.splice(sourceIndex, 1);
    srcBlock.registers = srcRegs;

    const tgtRegs = tgtBlock.registers ?? [];
    const clampedTarget = Math.max(0, Math.min(targetIndex, tgtRegs.length));
    tgtRegs.splice(clampedTarget, 0, removed);
    tgtBlock.registers = tgtRegs;

    const { data, errors } = recomputeAddressLayout(map);
    return { memoryMap: data, errors, newIndex: clampedTarget };
  }

  if (layer === 'field') {
    const srcBi = sourceParentPath.blockIndex;
    const srcRi = sourceParentPath.registerIndex ?? 0;
    const tgtBi = targetParentPath.blockIndex;
    const tgtRi = targetParentPath.registerIndex ?? 0;

    const srcBlock = blocks[srcBi];
    const tgtBlock = blocks[tgtBi];
    if (!srcBlock || !tgtBlock) {
      return {
        memoryMap,
        errors: [{ layer, parentPath: '', message: 'Block not found', severity: 'error' }],
        newIndex: -1,
      };
    }

    const srcReg = (srcBlock.registers ?? [])[srcRi];
    const tgtReg = (tgtBlock.registers ?? [])[tgtRi];
    if (!srcReg || !tgtReg) {
      return {
        memoryMap,
        errors: [{ layer, parentPath: '', message: 'Register not found', severity: 'error' }],
        newIndex: -1,
      };
    }

    const srcFields = srcReg.fields ?? [];
    if (sourceIndex < 0 || sourceIndex >= srcFields.length) {
      return {
        memoryMap,
        errors: [
          {
            layer,
            parentPath: `blocks[${srcBi}].registers[${srcRi}]`,
            message: 'Invalid source field index',
            severity: 'error',
          },
        ],
        newIndex: -1,
      };
    }

    const [removed] = srcFields.splice(sourceIndex, 1);
    srcReg.fields = srcFields;

    const tgtFields = tgtReg.fields ?? [];
    const clampedTarget = Math.max(0, Math.min(targetIndex, tgtFields.length));
    tgtFields.splice(clampedTarget, 0, removed);
    tgtReg.fields = tgtFields;

    const { data, errors } = recomputeFullLayout(map);
    return { memoryMap: data, errors, newIndex: clampedTarget };
  }

  return { memoryMap, errors: [], newIndex: -1 };
}

// ---------------------------------------------------------------------------
// Internal utilities
// ---------------------------------------------------------------------------

function computeInsertIndex(targetIndex: number, arrayLength: number, mode: InsertMode): number {
  if (arrayLength === 0) {
    return 0;
  }
  const clamped = targetIndex < 0 ? arrayLength - 1 : Math.min(targetIndex, arrayLength - 1);
  return mode === 'after' ? clamped + 1 : clamped;
}
