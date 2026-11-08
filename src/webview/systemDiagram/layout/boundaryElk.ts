/** Boundary pins (external ports of the level on show) as ELK nodes. */

import type { ElkNode } from 'elkjs/lib/elk-api';
import type { SystemPin } from '../../../domain/systemGraph';
import type { PinSide } from './diagramTypes';
import { portId } from './levelEdges';
import type { BadgeLabels } from './netBadges';
import { PORT_LABEL_OPTIONS } from './instanceElk';
import { PORT_SIZE } from './pinRows';
import { boundaryId, pinRole } from '../model';

export const BOUNDARY_HEIGHT = 26;

export function boundarySide(pin: SystemPin): PinSide {
  return pinRole(pin, true) === 'source' ? 'east' : 'west';
}

export function boundaryNode(
  levelPath: string,
  pin: SystemPin,
  width: number,
  badges: BadgeLabels
): ElkNode {
  const id = boundaryId(levelPath, pin.name);
  const side = boundarySide(pin);
  return {
    id,
    width,
    height: BOUNDARY_HEIGHT,
    layoutOptions: { 'org.eclipse.elk.portConstraints': 'FIXED_POS', ...PORT_LABEL_OPTIONS },
    ports: [
      {
        id: portId(id, pin.name),
        x: side === 'west' ? -PORT_SIZE / 2 : width - PORT_SIZE / 2,
        y: (BOUNDARY_HEIGHT - PORT_SIZE) / 2,
        width: PORT_SIZE,
        height: PORT_SIZE,
        labels: badges({ instance: null, pin: pin.name }),
      },
    ],
  };
}
