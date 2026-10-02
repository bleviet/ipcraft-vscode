import type { BusPortProjectionMetadata, ProjectedBusPort } from '../types';

/**
 * Endianness reflow policy for bus payload ports.
 *
 * Big-endian interfaces present their payload with the most significant lane
 * first at the HDL boundary, while generated internal logic is always
 * little-endian. This module owns the single decision of which canonical ports
 * need that reflow and how wide each reflowed element is; the actual boundary
 * wiring is planned in `boundaryTransforms.ts`.
 */

/** The swap-related slice of a projected port, keyed by canonical port role. */
type PortSwapProjection = Pick<
  ProjectedBusPort,
  'role' | 'swapKind' | 'laneWidth' | 'laneKind' | 'needsSwap'
>;

/** A payload is swappable when it contains at least two complete lanes. */
export function needsLaneSwap(
  endianness: 'little' | 'big',
  width: number | string | null,
  laneWidth: number | string,
  direction: string,
  isParameterized = false
): boolean {
  return (
    endianness === 'big' &&
    (direction === 'in' || direction === 'out') &&
    (isParameterized ||
      typeof width === 'string' ||
      typeof laneWidth === 'string' ||
      (typeof width === 'number' &&
        typeof laneWidth === 'number' &&
        laneWidth > 0 &&
        width > laneWidth &&
        width % laneWidth === 0))
  );
}

/** A multi-bit or parameterized qualifier reverses one bit per payload lane. */
export function needsBitReverse(
  endianness: 'little' | 'big',
  width: number | string | null,
  direction: string,
  isParameterized = false
): boolean {
  return (
    endianness === 'big' &&
    (direction === 'in' || direction === 'out') &&
    (isParameterized || (typeof width === 'number' && width > 1))
  );
}

/**
 * Decide the reflow projection for one canonical port. A `data` payload swaps
 * whole lanes; a `byteQualifier` reverses one bit per lane. Every other role
 * crosses the boundary untouched.
 */
export function buildPortSwapProjection(
  role: string | undefined,
  direction: string,
  width: number | string | null,
  isParameterized: boolean,
  metadata: BusPortProjectionMetadata
): PortSwapProjection {
  if (role === 'data') {
    return {
      role,
      swapKind: 'lane',
      laneWidth: metadata.laneWidth,
      laneKind: metadata.laneKind,
      needsSwap: needsLaneSwap(
        metadata.endianness,
        width,
        metadata.laneWidth,
        direction,
        isParameterized
      ),
    };
  }
  if (role === 'byteQualifier') {
    return {
      role,
      swapKind: 'bit',
      laneWidth: 1,
      laneKind: metadata.laneKind,
      needsSwap: needsBitReverse(metadata.endianness, width, direction, isParameterized),
    };
  }
  return { needsSwap: false };
}
