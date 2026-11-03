import React from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { categoryColor } from './colors';
import { NetBadgeView } from './NetBadgeView';
import { BOUNDARY_HEIGHT, BOUNDARY_WIDTH, type BoundaryNodeData } from './layout/elkLayout';

export type BoundaryFlowNode = Node<BoundaryNodeData, 'boundary'>;

export function BoundaryNode({ data, selected }: NodeProps<BoundaryFlowNode>) {
  const { pin } = data;
  const east = data.side === 'east';
  const position = east ? Position.Right : Position.Left;
  return (
    <div
      className="sd-node flex items-center gap-1 px-2"
      data-selected={selected}
      data-dimmed={data.dimmed === true}
      style={{ width: BOUNDARY_WIDTH, height: BOUNDARY_HEIGHT }}
      title={`${pin.name} · ${data.netName ?? 'unconnected'} · ${pin.direction} from ${pin.directionSource}`}
    >
      <span
        aria-hidden="true"
        className={`inline-block h-2 w-2 shrink-0 ${pin.isInterface ? '' : 'rounded-full'}`}
        style={{ background: categoryColor(data.category) }}
      />
      <span className="truncate">{pin.name}</span>
      {data.badge && <NetBadgeView badge={data.badge} onSelectNet={data.onSelectNet} />}
      {(['source', 'target'] as const).map((type) => (
        <Handle
          key={type}
          type={type}
          id={pin.name}
          position={position}
          isConnectable={false}
          className="sd-handle"
        />
      ))}
    </div>
  );
}
