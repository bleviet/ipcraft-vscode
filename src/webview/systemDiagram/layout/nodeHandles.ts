/**
 * The connection handles of a flow node, built from the layout. A node component renders a
 * source and a target `<Handle>` per pin; giving React Flow the same set up front means it
 * never depends on measuring the DOM for them, so a node that is not mounted keeps handles
 * that match its current pins (see the measured note in docs/architecture/webview.md).
 */

import type { NodeHandle, Position } from '@xyflow/react';
import type { ElkPort } from 'elkjs/lib/elk-api';
import { PORT_SIZE } from './pinRows';
import type { PinSide } from './diagramTypes';

/**
 * React Flow's `Position` values, kept local so the layout (also run by the CLI renderer)
 * does not load React at runtime.
 */
const POSITION = { left: 'left' as Position, right: 'right' as Position };

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
      position: side === 'east' ? POSITION.right : POSITION.left,
      x: port?.x ?? 0,
      y: port?.y ?? 0,
      width: PORT_SIZE,
      height: PORT_SIZE,
    }));
  });
}
