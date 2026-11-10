/**
 * The ELK layer constraints that put the boundary pins of the shown level in
 * two columns. Pure; the inputs are typed arguments, not the build context.
 */

import type { ElkExtendedEdge } from 'elkjs/lib/elk-api';
import type { SystemPin } from '../../../domain/systemGraph';
import type { PinSide } from './diagramTypes';
import { boundaryId, pinRole } from '../model';

export function boundarySide(pin: SystemPin): PinSide {
  return pinRole(pin, true) === 'source' ? 'east' : 'west';
}

/**
 * How a right-column boundary node drives other right-column nodes: `leaf`
 * drives only non-drivers, `chain` drives a driver.
 */
export type RightDrive = 'leaf' | 'chain';

/**
 * The ELK options that put a boundary pin in its column: an input (`east` side)
 * in a layer of its own before every block, left aligned; every other port in a
 * layer of its own after every block, right aligned (so the right edges match).
 * ELK rejects a LAST_SEPARATE node with an outgoing edge, and reverses such an
 * edge only when its target is unconstrained. A right-column port that drives
 * another right-column port (a net with no source endpoint falls back to its
 * first endpoint as driver) is `LAST`, which ELK accepts before a LAST_SEPARATE
 * target; it is placed in the last layer, which blocks can share. In a chain
 * of such ports, `LAST` to `LAST` throws, so a port that drives another driver
 * is left unconstrained.
 */
export function boundaryColumnOptions(pin: SystemPin, drive?: RightDrive): Record<string, string> {
  if (boundarySide(pin) === 'east') {
    return { 'elk.layered.layering.layerConstraint': 'FIRST_SEPARATE', 'elk.alignment': 'LEFT' };
  }
  if (drive === 'chain') {
    return {};
  }
  return {
    'elk.layered.layering.layerConstraint': drive === 'leaf' ? 'LAST' : 'LAST_SEPARATE',
    'elk.alignment': 'RIGHT',
  };
}

/** The right-column boundary nodes of `levelPath` that are the source of an edge to another one. */
export function rightColumnDrivers(
  boundaryPins: readonly SystemPin[],
  levelPath: string,
  edges: readonly ElkExtendedEdge[]
): Map<string, RightDrive> {
  const rightNodes = new Set(
    boundaryPins
      .filter((pin) => boundarySide(pin) === 'west')
      .map((pin) => boundaryId(levelPath, pin.name))
  );
  const owner = (portRef: string) => portRef.slice(0, portRef.lastIndexOf('::'));
  const pairs = edges
    .map((edge) => [owner(edge.sources[0]), owner(edge.targets[0])] as const)
    .filter(([source, target]) => rightNodes.has(source) && rightNodes.has(target));
  const drivers = new Set(pairs.map(([source]) => source));
  const result = new Map<string, RightDrive>();
  for (const [source, target] of pairs) {
    if (drivers.has(target)) {
      result.set(source, 'chain');
    } else if (!result.has(source)) {
      result.set(source, 'leaf');
    }
  }
  return result;
}
