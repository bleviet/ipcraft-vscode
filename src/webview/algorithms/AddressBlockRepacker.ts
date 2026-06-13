/**
 * Address block repacking algorithms for maintaining proper block layouts
 */

import type { AddressBlockRecord } from '../types/editor';
import { calculateBlockSize } from '../utils/blockSize';

/**
 * Repack address blocks forward (toward higher addresses) starting from the given index.
 * Maintains block sizes but shifts them to higher addresses.
 * Calculates block size based on registers and register arrays.
 * @param blocks Array of address blocks
 * @param fromIndex Starting index for repacking (inclusive)
 * @returns New array with repacked blocks
 */
export function repackBlocksForward(
  blocks: AddressBlockRecord[],
  fromIndex: number
): AddressBlockRecord[] {
  const newBlocks = [...blocks];
  if (fromIndex < 0 || fromIndex >= newBlocks.length) {
    return newBlocks;
  }

  // Start from the block just before fromIndex to determine the starting position
  let nextBase = 0;
  if (fromIndex > 0) {
    const prevBlock = newBlocks[fromIndex - 1];
    const prevBase: number = typeof prevBlock.baseAddress === 'number' ? prevBlock.baseAddress : 0;
    const prevSize = calculateBlockSize(prevBlock);
    nextBase = prevBase + prevSize;
  }

  for (let i = fromIndex; i < newBlocks.length; i++) {
    const block = newBlocks[i];
    const blockSize = calculateBlockSize(block);

    newBlocks[i] = {
      ...block,
      baseAddress: nextBase,
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
export function repackBlocksBackward(
  blocks: AddressBlockRecord[],
  fromIndex: number
): AddressBlockRecord[] {
  const newBlocks = [...blocks];
  if (newBlocks.length === 0) {
    return [];
  }
  if (fromIndex < 0 || fromIndex >= newBlocks.length) {
    return newBlocks;
  }

  // Start from the block just after fromIndex to determine the starting position.
  // `nextEnd` tracks an inclusive end address; `Infinity` preserves the current
  // block base for the first processed element when repacking from the tail.
  let nextEnd: number =
    fromIndex < newBlocks.length - 1 ? (newBlocks[fromIndex + 1].baseAddress ?? 0) - 1 : Infinity;

  for (let i = fromIndex; i >= 0; i--) {
    const block = newBlocks[i];
    const size = calculateBlockSize(block);

    // Use inclusive-address arithmetic: base = end - size + 1.
    const base = nextEnd === Infinity ? (block.baseAddress ?? 0) : nextEnd - size + 1;
    newBlocks[i] = {
      ...block,
      baseAddress: Math.max(0, base),
    };
    nextEnd = base - 1;
  }

  return newBlocks;
}
