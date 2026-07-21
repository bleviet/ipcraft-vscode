/**
 * LayoutEngine
 *
 * Unified, stateless layout computation for memory-mapped register spaces.
 * Every function is pure: no mutation, no React, no DOM, no YAML.
 *
 * The fundamental invariant is: **array position is the sole source of truth
 * for spatial layout**. After any structural mutation the caller invokes
 * `recomputeFullLayout()` which sweeps top-down (blocks -> registers ->
 * fields) and stamps correct offsets/ranges based purely on sequential
 * position and element sizes.
 */

import { formatBitsRange, parseBitsRange, fieldToBitsString } from '../utils/BitFieldUtils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Minimal bit-field shape used by the layout engine. */
export interface LayoutField {
  name?: string;
  bits?: string | null;
  offset?: number | null;
  width?: number | null;
  bitRange?: [number, number];
  [key: string]: unknown;
}

/** Minimal register shape used by the layout engine. */
export interface LayoutRegister {
  name?: string;
  offset?: number | null;
  size?: number;
  /** Present on register-array nodes. */
  __kind?: string;
  count?: number;
  stride?: number;
  fields?: LayoutField[];
  registers?: LayoutRegister[];
  [key: string]: unknown;
}

/** Minimal address-block shape used by the layout engine. */
export interface LayoutBlock {
  name?: string;
  baseAddress?: number;
  size?: number;
  range?: number | string;
  defaultRegWidth?: number;
  registers?: LayoutRegister[];
  [key: string]: unknown;
}

/** Minimal memory-map shape used by the layout engine. */
export interface LayoutMemoryMap {
  name?: string;
  addressBlocks?: LayoutBlock[];
  [key: string]: unknown;
}

/** A layout validation error. */
export interface LayoutError {
  layer: 'block' | 'register' | 'field';
  /** Human-readable path to the parent, e.g. "blocks[0].registers[2]" */
  parentPath: string;
  message: string;
  severity: 'error' | 'warning';
}

/** Result of a layout computation that may produce validation errors. */
export interface LayoutResult<T> {
  data: T;
  errors: LayoutError[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Compute register footprint in bytes, respecting size/count/stride. */
function registerFootprintBytes(reg: LayoutRegister): number {
  const count = typeof reg.count === 'number' && reg.count > 1 ? reg.count : 0;
  if (count > 0) {
    return (reg.stride ?? 4) * count;
  }
  const bits = typeof reg.size === 'number' && reg.size > 0 ? reg.size : 32;
  return Math.max(1, Math.floor(bits / 8));
}

/** Get effective register width for the block (bits). */
function effectiveRegWidth(block: LayoutBlock): number {
  const raw = block.defaultRegWidth;
  const bits = typeof raw === 'number' && raw > 0 ? raw : 32;
  return bits;
}

/** Parse bit bounds from a field, returning [msb, lsb] or null. */
function fieldBounds(field: LayoutField): [number, number] | null {
  const bitsStr = fieldToBitsString(
    field as { offset?: number | null; width?: number | null; bits?: string | null }
  );
  return parseBitsRange(bitsStr);
}

/** Compute block size from its register array. */
function computeBlockSize(block: LayoutBlock): number {
  const regs = block.registers ?? [];
  if (regs.length === 0) {
    const explicit =
      typeof block.size === 'number'
        ? block.size
        : typeof block.range === 'number'
          ? block.range
          : 4;
    return explicit;
  }
  let total = 0;
  for (const reg of regs) {
    total += registerFootprintBytes(reg);
  }
  return total;
}

// ---------------------------------------------------------------------------
// Bitfield Layout
// ---------------------------------------------------------------------------

/**
 * Recompute bit-field layout for a register.
 *
 * Fields are stamped with contiguous, non-overlapping bit ranges in array
 * order (index 0 = LSB). Each field preserves its original width.
 *
 * @param fields     Fields array (not mutated).
 * @param regWidth   Register width in bits (e.g. 32).
 * @returns          New fields array with corrected layout metadata.
 */
export function recomputeBitfieldLayout(fields: LayoutField[], regWidth: number): LayoutField[] {
  const width = regWidth > 0 ? regWidth : 32;
  let nextLsb = 0;

  return fields.map((field) => {
    // Preserve original width when possible.
    const bounds = fieldBounds(field);
    const fieldWidth = bounds
      ? Math.abs(bounds[0] - bounds[1]) + 1
      : typeof field.width === 'number' && field.width > 0
        ? field.width
        : 1;

    const lsb = nextLsb;
    const msb = Math.min(width - 1, lsb + fieldWidth - 1);
    const clampedWidth = msb - lsb + 1;
    nextLsb = msb + 1;

    return {
      ...field,
      bits: formatBitsRange(msb, lsb),
      offset: lsb,
      width: clampedWidth,
      bitRange: [msb, lsb] as [number, number],
    };
  });
}

/**
 * Reorder bit-field layout after a single adjacent-field swap.
 *
 * After `moveField` swaps two fields in the array, their `bits` values still
 * reflect the pre-swap positions.  This function builds segments from those
 * old positions (including any gaps), swaps the two field segments, then
 * repacks to produce new bit positions that preserve gaps.
 *
 * @param fields     Fields array immediately after the move (bits still old).
 * @param movedIdx   New array index of the field that was moved.
 * @param direction  'lsb' when moved up in array (toward lower bits);
 *                   'msb' when moved down in array (toward higher bits).
 * @param regWidth   Register width in bits.
 */
export function reorderBitfieldLayout(
  fields: LayoutField[],
  movedIdx: number,
  direction: 'lsb' | 'msb',
  regWidth: number
): LayoutField[] {
  const width = regWidth > 0 ? regWidth : 32;

  type Seg = { idx: number; lo: number; hi: number; isGap: boolean };

  const fieldSegs: { lo: number; hi: number; idx: number }[] = [];
  fields.forEach((field, i) => {
    const bounds = fieldBounds(field);
    if (bounds) {
      const hi = Math.max(bounds[0], bounds[1]);
      const lo = Math.min(bounds[0], bounds[1]);
      fieldSegs.push({ lo, hi, idx: i });
    }
  });

  // Build MSB-first segment list including gap segments.
  fieldSegs.sort((a, b) => b.hi - a.hi);
  const segs: Seg[] = [];
  let cursor = width - 1;
  for (const fs of fieldSegs) {
    if (cursor > fs.hi) {
      segs.push({ idx: -1, lo: fs.hi + 1, hi: cursor, isGap: true });
    }
    segs.push({ idx: fs.idx, lo: fs.lo, hi: fs.hi, isGap: false });
    cursor = fs.lo - 1;
  }
  if (cursor >= 0) {
    segs.push({ idx: -1, lo: 0, hi: cursor, isGap: true });
  }

  const sourceSegIdx = segs.findIndex((s) => !s.isGap && s.idx === movedIdx);
  if (sourceSegIdx === -1) {
    return recomputeBitfieldLayout(fields, regWidth);
  }

  // Skip over gap segments so the table-row swap always targets the next FIELD,
  // not an intermediate gap (e.g. when FIFO_LEVEL and BUSY have a gap between them).
  const step = direction === 'msb' ? -1 : 1;
  let targetSegIdx = sourceSegIdx + step;
  while (targetSegIdx >= 0 && targetSegIdx < segs.length && segs[targetSegIdx].isGap) {
    targetSegIdx += step;
  }
  if (targetSegIdx < 0 || targetSegIdx >= segs.length) {
    return recomputeBitfieldLayout(fields, regWidth);
  }

  // Swap the two field segments (gap segments between them stay in place).
  const reordered = [...segs];
  const [moved] = reordered.splice(sourceSegIdx, 1);
  reordered.splice(targetSegIdx, 0, moved);

  // Repack from LSB.
  let currentBit = 0;
  const repacked = [...reordered]
    .reverse()
    .map((seg) => {
      const segWidth = seg.hi - seg.lo + 1;
      const lo = currentBit;
      const hi = currentBit + segWidth - 1;
      currentBit += segWidth;
      return { ...seg, lo, hi };
    })
    .reverse();

  const newFields = fields.map((f) => ({ ...f }));
  for (const seg of repacked) {
    if (!seg.isGap) {
      const { lo, hi } = seg;
      newFields[seg.idx] = {
        ...newFields[seg.idx],
        bits: formatBitsRange(hi, lo),
        offset: lo,
        width: hi - lo + 1,
        bitRange: [hi, lo] as [number, number],
      };
    }
  }
  return newFields;
}

// ---------------------------------------------------------------------------
// Register Layout
// ---------------------------------------------------------------------------

/**
 * Recompute register offsets within an address block.
 *
 * Registers are packed contiguously in array order starting from offset 0.
 * Each register's footprint is derived from its `size` (bits) or
 * `count * stride` for arrays.
 *
 * @param registers        Registers array (not mutated).
 * @param _defaultRegWidth Block-level default register width in bits (unused
 *                         for footprint -- each register's own size is used).
 * @returns                New registers array with corrected offsets.
 */
export function recomputeRegisterLayout(
  registers: LayoutRegister[],
  _defaultRegWidth = 32
): LayoutRegister[] {
  let nextOffset = 0;

  return registers.map((reg) => {
    const offset = nextOffset;
    const footprint = registerFootprintBytes(reg);
    nextOffset = offset + footprint;

    const updated: LayoutRegister = {
      ...reg,
      offset: offset,
    };

    // Recurse into register-array template registers.
    if (Array.isArray(reg.registers)) {
      const subRegs = recomputeRegisterLayout(reg.registers, _defaultRegWidth);
      updated.registers = subRegs;

      const templateFootprint = subRegs.reduce((sum, r) => sum + registerFootprintBytes(r), 0);
      const alignedFootprint = Math.ceil(templateFootprint / 4) * 4;
      const currentStride = reg.stride ?? 4;
      if (currentStride < alignedFootprint) {
        updated.stride = alignedFootprint;
      }
    }

    return updated;
  });
}

// ---------------------------------------------------------------------------
// Block Layout
// ---------------------------------------------------------------------------

/**
 * Recompute address-block base addresses within a memory map.
 *
 * Blocks are packed contiguously in array order starting from base 0.
 * Each block's size is derived from its register content.
 *
 * @param blocks  Blocks array (not mutated).
 * @returns       New blocks array with corrected base addresses.
 */
export function recomputeBlockLayout(blocks: LayoutBlock[]): LayoutBlock[] {
  let nextBase = 0;

  return blocks.map((block) => {
    const base = nextBase;
    const size = computeBlockSize(block);
    nextBase = base + size;

    return {
      ...block,
      baseAddress: base,
    };
  });
}

// ---------------------------------------------------------------------------
// Full Layout Sweep
// ---------------------------------------------------------------------------

/**
 * Recompute address-level layout (register offsets + block base addresses)
 * WITHOUT modifying bitfield positions.
 *
 * Use this when structural array changes (register insert/delete/reorder,
 * block insert/delete/reorder) need offset correction while preserving
 * the user's existing bitfield layout.
 *
 * @param memoryMap  Memory map object (not mutated).
 * @returns          New memory map with corrected offsets only.
 */
export function recomputeAddressLayout(memoryMap: LayoutMemoryMap): LayoutResult<LayoutMemoryMap> {
  const blocks = memoryMap.addressBlocks ?? [];
  const errors: LayoutError[] = [];

  // Recompute register offsets within each block — no field changes.
  const updatedBlocks = blocks.map((block) => {
    const regWidth = effectiveRegWidth(block);
    const regs = block.registers ?? [];
    const regsWithOffsets = recomputeRegisterLayout(regs, regWidth);
    return { ...block, registers: regsWithOffsets };
  });

  // Recompute block base addresses.
  const blocksWithBases = recomputeBlockLayout(updatedBlocks);

  const result: LayoutMemoryMap = { ...memoryMap, addressBlocks: blocksWithBases };
  return { data: result, errors };
}

/**
 * Top-down layout recomputation for an entire memory map.
 *
 * 1. For each block, recompute register offsets.
 * 2. For each register, recompute bitfield ranges.
 * 3. Recompute block base addresses.
 *
 * @param memoryMap  Memory map object (not mutated).
 * @returns          New memory map with all layout metadata corrected,
 *                   plus any validation errors.
 */
export function recomputeFullLayout(memoryMap: LayoutMemoryMap): LayoutResult<LayoutMemoryMap> {
  const blocks = memoryMap.addressBlocks ?? [];
  const errors: LayoutError[] = [];

  // Phase 1: recompute registers and fields within each block.
  const updatedBlocks = blocks.map((block) => {
    const regWidth = effectiveRegWidth(block);
    const regs = block.registers ?? [];

    // Recompute fields within each register.
    const regsWithFields = regs.map((reg) => {
      const updated = { ...reg };

      if (Array.isArray(reg.fields) && reg.fields.length > 0) {
        const regSize = typeof reg.size === 'number' && reg.size > 0 ? reg.size : regWidth;
        updated.fields = recomputeBitfieldLayout(reg.fields, regSize);
      }

      // Recurse into register-array template registers.
      if (Array.isArray(reg.registers)) {
        updated.registers = reg.registers.map((subReg) => {
          if (!Array.isArray(subReg.fields) || subReg.fields.length === 0) {
            return subReg;
          }
          const subSize =
            typeof subReg.size === 'number' && subReg.size > 0 ? subReg.size : regWidth;
          return {
            ...subReg,
            fields: recomputeBitfieldLayout(subReg.fields, subSize),
          };
        });
      }

      return updated;
    });

    // Recompute register offsets.
    const regsWithOffsets = recomputeRegisterLayout(regsWithFields, regWidth);

    return {
      ...block,
      registers: regsWithOffsets,
    };
  });

  // Phase 2: recompute block base addresses.
  const blocksWithBases = recomputeBlockLayout(updatedBlocks);

  // Phase 3: validation.
  for (let bi = 0; bi < blocksWithBases.length; bi++) {
    const block = blocksWithBases[bi];
    const blockPath = `blocks[${bi}]`;

    // Check block overlap with next block.
    if (bi < blocksWithBases.length - 1) {
      const nextBlock = blocksWithBases[bi + 1];
      const blockEnd = (block.baseAddress ?? 0) + computeBlockSize(block);
      if (blockEnd > (nextBlock.baseAddress ?? 0)) {
        errors.push({
          layer: 'block',
          parentPath: blockPath,
          message: `Block "${block.name}" ends at 0x${blockEnd.toString(16)} but next block "${nextBlock.name}" starts at 0x${(nextBlock.baseAddress ?? 0).toString(16)}`,
          severity: 'error',
        });
      }
    }

    const regs = block.registers ?? [];
    for (let ri = 0; ri < regs.length; ri++) {
      const reg = regs[ri];
      const regPath = `${blockPath}.registers[${ri}]`;

      // Check register overlap with next register.
      if (ri < regs.length - 1) {
        const nextReg = regs[ri + 1];
        const regEnd = (reg.offset ?? 0) + registerFootprintBytes(reg);
        const nextStart = nextReg.offset ?? 0;
        if (regEnd > nextStart) {
          errors.push({
            layer: 'register',
            parentPath: regPath,
            message: `Register "${reg.name}" ends at offset 0x${regEnd.toString(16)} but next register "${nextReg.name}" starts at 0x${nextStart.toString(16)}`,
            severity: 'error',
          });
        }
      }

      // Check bitfield overlaps within this register.
      const fields = reg.fields ?? [];
      const regSize =
        typeof reg.size === 'number' && reg.size > 0 ? reg.size : effectiveRegWidth(block);
      for (let fi = 0; fi < fields.length; fi++) {
        const field = fields[fi];
        const fBounds = fieldBounds(field);
        if (!fBounds) {
          continue;
        }
        const [fMsb, fLsb] = fBounds;

        // Check field exceeds register width.
        if (fMsb >= regSize) {
          errors.push({
            layer: 'field',
            parentPath: `${regPath}.fields[${fi}]`,
            message: `Field "${field.name}" MSB ${fMsb} exceeds register width ${regSize}`,
            severity: 'error',
          });
        }

        // Check overlap with subsequent fields.
        for (let fj = fi + 1; fj < fields.length; fj++) {
          const other = fields[fj];
          const oBounds = fieldBounds(other);
          if (!oBounds) {
            continue;
          }
          const [oMsb, oLsb] = oBounds;
          if (fLsb <= oMsb && fMsb >= oLsb) {
            errors.push({
              layer: 'field',
              parentPath: `${regPath}.fields[${fi}]`,
              message: `Field "${field.name}" [${fMsb}:${fLsb}] overlaps with "${other.name}" [${oMsb}:${oLsb}]`,
              severity: 'error',
            });
          }
        }
      }
    }
  }

  const result: LayoutMemoryMap = {
    ...memoryMap,
    addressBlocks: blocksWithBases,
  };

  return { data: result, errors };
}

/**
 * Validate a memory map layout without recomputing.
 * Useful for checking a map that already has offsets assigned.
 */
export function validateLayout(memoryMap: LayoutMemoryMap): LayoutError[] {
  // Run full layout and return only errors (the data is discarded).
  // Since recomputeFullLayout also validates, we just forward.
  return recomputeFullLayout(memoryMap).errors;
}
