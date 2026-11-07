/** Boundary pins (external ports of the level on show) as ELK nodes. */

import type { ElkNode } from 'elkjs/lib/elk-api';
import type { SystemGraph, SystemPin } from '../../../domain/systemGraph';
import type { PinSide } from './diagramTypes';
import { portId } from './levelEdges';
import { badgeLabels, type clockResetNetsByEndpoint } from './netBadges';
import { PORT_LABEL_OPTIONS } from './instanceElk';
import { PORT_SIZE } from './pinRows';
import { boundaryId, pinRole } from '../model';

export const BOUNDARY_HEIGHT = 26;

type ClockResetNets = ReturnType<typeof clockResetNetsByEndpoint>;

export function boundarySide(pin: SystemPin): PinSide {
  return pinRole(pin, true) === 'source' ? 'east' : 'west';
}

export function boundaryNode(
  graph: SystemGraph,
  levelPath: string,
  pin: SystemPin,
  width: number,
  clockReset: ClockResetNets,
  traced: boolean
): ElkNode {
  const id = boundaryId(levelPath, pin.name);
  const side = boundarySide(pin);
  const role = pinRole(pin, true);
  const layoutOptions: Record<string, string> = {
    'org.eclipse.elk.portConstraints': 'FIXED_POS',
    ...PORT_LABEL_OPTIONS,
  };
  // A traced path is ordered by partitions; ELK rejects a layer constraint beside them.
  if (!traced && role === 'source') {
    layoutOptions['elk.layered.layering.layerConstraint'] = 'FIRST';
  } else if (!traced && role === 'sink') {
    layoutOptions['elk.layered.layering.layerConstraint'] = 'LAST';
  }
  return {
    id,
    width,
    height: BOUNDARY_HEIGHT,
    layoutOptions,
    ports: [
      {
        id: portId(id, pin.name),
        x: side === 'west' ? -PORT_SIZE / 2 : width - PORT_SIZE / 2,
        y: (BOUNDARY_HEIGHT - PORT_SIZE) / 2,
        width: PORT_SIZE,
        height: PORT_SIZE,
        labels: badgeLabels(graph, clockReset, { instance: null, pin: pin.name }),
      },
    ],
  };
}
