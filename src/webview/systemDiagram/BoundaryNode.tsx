import React from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { NetBadgeView } from './NetBadgeView';
import { PinMarker } from './PinMarker';
import { BOUNDARY_HEIGHT, type BoundaryNodeData } from './layout/elkLayout';
import { portShapePath } from './layout/portShape';

export type BoundaryFlowNode = Node<BoundaryNodeData, 'boundary'>;

/** External port drawn as an arrow tag, its marker centred on the border it connects from. */
export function BoundaryNode({ data, selected }: NodeProps<BoundaryFlowNode>) {
  const { pin } = data;
  const east = data.side === 'east';
  const position = east ? Position.Right : Position.Left;
  return (
    <div
      className="sd-port"
      data-selected={selected}
      data-dimmed={data.dimmed === true}
      style={{ width: data.width, height: BOUNDARY_HEIGHT }}
      aria-label={data.label === pin.name ? undefined : pin.name}
      onPointerEnter={(event) =>
        data.onHoverPin?.(
          { pin, netNames: data.netNames, side: data.side },
          event.currentTarget.getBoundingClientRect()
        )
      }
      onPointerLeave={() => data.onHoverPin?.(null)}
    >
      <svg className="sd-port-shape" aria-hidden="true" width={data.width} height={BOUNDARY_HEIGHT}>
        <path d={portShapePath(data.width, BOUNDARY_HEIGHT, pin.direction === 'inout')} />
      </svg>
      <PinMarker
        isInterface={pin.isInterface}
        category={data.category}
        side={data.side}
        inset={0}
      />
      <span className="sd-port-label" style={{ lineHeight: `${BOUNDARY_HEIGHT}px` }}>
        {data.label}
      </span>
      {data.badge && <NetBadgeView badge={data.badge} onSelectNet={data.onSelectNet} />}
      {(['source', 'target'] as const).map((type) => (
        <Handle
          key={type}
          type={type}
          id={pin.name}
          position={position}
          isConnectable={false}
          className="sd-handle"
          style={{ [east ? 'right' : 'left']: 0 }}
        />
      ))}
    </div>
  );
}
