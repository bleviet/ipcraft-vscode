/**
 * Pin geometry shared by instance blocks and expanded hierarchy frames: row
 * sizes, which border a pin sits on, and the {@link PinRow} drawn for it.
 */

import type { PinDirection, SystemNet, SystemPin } from '../../../domain/systemGraph';
import type { PinRow, PinSide } from './diagramTypes';
import type { NetBadge } from './netBadges';

export const HEADER_HEIGHT = 42;
export const PIN_ROW_HEIGHT = 18;
export const PORT_SIZE = 8;

export function sideOfInstancePin(direction: PinDirection): PinSide {
  return direction === 'out' || direction === 'master' || direction === 'inout' ? 'east' : 'west';
}

export function splitSides(pins: readonly SystemPin[]): Record<PinSide, SystemPin[]> {
  const sides: Record<PinSide, SystemPin[]> = { west: [], east: [] };
  for (const pin of pins) {
    sides[sideOfInstancePin(pin.direction)].push(pin);
  }
  return sides;
}

/** Row of an instance pin; `nets` are every net it sits on, the first giving its category and name. */
export function pinRow(
  pin: SystemPin,
  nets: readonly SystemNet[],
  label: string,
  badge: NetBadge | undefined
): PinRow {
  const net = nets[0];
  return {
    name: pin.name,
    isInterface: pin.isInterface,
    side: sideOfInstancePin(pin.direction),
    direction: pin.direction,
    directionSource: pin.directionSource,
    category: net?.category,
    netName: net?.name,
    netNames: nets.map((candidate) => candidate.name),
    ...(pin.definedBy !== undefined && { definedBy: pin.definedBy }),
    ...(pin.interfaceType !== undefined && { interfaceType: pin.interfaceType }),
    ...(pin.signalType !== undefined && { signalType: pin.signalType }),
    label,
    unconnected: nets.length === 0,
    badge,
  };
}
