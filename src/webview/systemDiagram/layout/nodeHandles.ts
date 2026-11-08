/**
 * The connection handles of a flow node, built from the layout. A node component renders a
 * source and a target `<Handle>` per pin; giving React Flow the same set up front means it
 * never depends on measuring the DOM for them, so a node that is not mounted keeps handles
 * that match its current pins (see the measured note in docs/architecture/webview.md).
 */

import { Position, type NodeHandle } from '@xyflow/react';
import type { ElkPort } from 'elkjs/lib/elk-api';
import { PORT_SIZE } from './pinRows';
import type { PinSide } from './diagramTypes';

export function pinHandles(
  nodeId: string,
  pins: readonly { name: string; side: PinSide }[],
  ports: ReadonlyMap<string, ElkPort>,
  portIdOf: (pinName: string) => string
): NodeHandle[] {
  return pins.flatMap(({ name, side }) => {
    const port = ports.get(portIdOf(name));
    return (['source', 'target'] as const).map((type) => ({
      id: name,
      type,
      position: side === 'east' ? Position.Right : Position.Left,
      x: port?.x ?? 0,
      y: port?.y ?? 0,
      width: PORT_SIZE,
      height: PORT_SIZE,
    }));
  });
}
