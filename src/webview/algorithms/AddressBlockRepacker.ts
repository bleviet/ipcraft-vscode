/**
 * Address block repacking algorithms for maintaining proper block layouts
 */

import type { AddressBlockRecord, RegisterRecord } from '../types/editor';

/**
 * Calculate block size based on registers and register arrays
 * For regular registers: 4 bytes per register
 * For register arrays: count * stride bytes
 */
function calculateBlockSize(block: AddressBlockRecord): number {
  const registers: RegisterRecord[] = block?.registers || [];
  if (registers.length === 0) {
    return typeof block?.size === "number" ? block.size : 4;
  }

  let totalSize = 0;
  for (const reg of registers) {
    if (reg.__kind === "array") {
      // Register array: size = count * stride
      const count = reg.count || 1;
      const stride = reg.stride || 4;
      totalSize += count * stride;
    } else {
      // Regular register: 4 bytes
      totalSize += 4;
    }
  }
  return totalSize;
}

/**
 * Repack address blocks forward (toward higher addresses) starting from the given index.
 * Maintains block sizes but shifts them to higher addresses.
 * Calculates block size based on registers and register arrays.
 * @param blocks Array of address blocks
 * @param fromIndex Starting index for repacking (inclusive)
 * @returns New array with repacked blocks
 */
export function repackBlocksForward(blocks: AddressBlockRecord[], fromIndex: number): AddressBlockRecord[] {
  const newBlocks = [...blocks];

  // Start from the block just before fromIndex to determine the starting position
  let nextBase = 0;
  if (fromIndex > 0) {
    const prevBlock = newBlocks[fromIndex - 1];
    const prevBase: number =
      typeof prevBlock.base_address === "number" ? prevBlock.base_address : 0;
    const prevSize = calculateBlockSize(prevBlock);
    nextBase = prevBase + prevSize;
  }

  for (let i = fromIndex; i < newBlocks.length; i++) {
    const block = newBlocks[i];
    const blockSize = calculateBlockSize(block);

    newBlocks[i] = {
      ...block,
      base_address: nextBase,
      size: blockSize,
    };
    nextBase += blockSize;
  }

  return newBlocks;
}

/**
 * Repack address blocks backward (toward lower addresses) starting from the given index going backwards.
 * Maintains block sizes but shifts them to lower addresses.
 * Calculates block size based on registers and register arrays.
 * @param blocks Array of address blocks
 * @param fromIndex Starting index for repacking (inclusive), goes backward to index 0
 * @returns New array with repacked blocks
 */
export function repackBlocksBackward(blocks: AddressBlockRecord[], fromIndex: number): AddressBlockRecord[] {
  const newBlocks = [...blocks];
  if (newBlocks.length === 0) {
    return [];
  }

  // Start from the block just after fromIndex to determine the starting position.
  // `nextEnd` tracks an inclusive end address; `Infinity` preserves the current
  // block base for the first processed element when repacking from the tail.
  let nextEnd: number =
    fromIndex < newBlocks.length - 1
      ? (newBlocks[fromIndex + 1].base_address ?? 0) - 1
      : Infinity;

  for (let i = fromIndex; i >= 0; i--) {
    const block = newBlocks[i];
    const size = calculateBlockSize(block);

    // Use inclusive-address arithmetic: base = end - size + 1.
    const base = nextEnd === Infinity ? (block.base_address ?? 0) : nextEnd - size + 1;
    newBlocks[i] = {
      ...block,
      base_address: Math.max(0, base),
      size,
    };
    nextEnd = base - 1;
  }

  return newBlocks;
}
