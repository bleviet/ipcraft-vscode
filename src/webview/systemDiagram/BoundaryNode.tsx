import React, { memo } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { NetBadgeView } from './NetBadgeView';
import { PinMarker } from './PinMarker';
import { PinFrequency, PinHalo, PinStub } from './PinDecor';
import { unconnectedClass } from './unconnectedPins';
import { BOUNDARY_HEIGHT, type BoundaryNodeData } from './layout/elkLayout';
import { portShapePath } from './layout/portShape';

export type BoundaryFlowNode = Node<BoundaryNodeData, 'boundary'>;

/** External port drawn as an arrow tag, its marker centred on the border it connects from. */
function BoundaryNodeBase({ data, selected }: NodeProps<BoundaryFlowNode>) {
  const { pin } = data;
  const east = data.side === 'east';
  const position = east ? Position.Right : Position.Left;
  const { review } = data;
  const mark = data.pinMarks?.[pin.name];
  const unconnected = review !== undefined && data.netNames.length === 0;
  return (
    <div
      className="sd-port"
      data-selected={selected}
      data-highlighted={data.highlightColor !== undefined || undefined}
      {...(review && {
        'data-has-unc': review.all > 0,
        'data-has-undriven': review.undriven > 0,
      })}
      {...(mark?.crossing && { 'data-crossing-end': true })}
      style={{
        width: data.width,
        height: BOUNDARY_HEIGHT,
        ...(data.highlightColor && { '--sd-highlight': data.highlightColor }),
      }}
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
      {data.focusedPin === pin.name && <PinHalo side={data.side} inset={0} />}
      {unconnected && <PinStub cls={unconnectedClass(pin, true)} side={data.side} inset={0} />}
      <PinMarker
        isInterface={pin.isInterface}
        category={data.category}
        color={mark?.color}
        side={data.side}
        inset={0}
      />
      {mark?.frequency && (
        <PinFrequency
          text={mark.frequency}
          color={mark.color}
          side={data.side}
          hasBadge={data.badge !== undefined}
        />
      )}
      <span
        className="sd-port-label"
        data-crossing={mark?.crossing}
        style={{ lineHeight: `${BOUNDARY_HEIGHT}px` }}
      >
        {data.label}
      </span>
      {data.badge && (
        <NetBadgeView
          badge={data.badge}
          selectedNetIds={data.selectedNetIds}
          onSelectNet={data.onSelectNet}
        />
      )}
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

/** Memoized: React Flow re-renders a node only when its data object changes. */
export const BoundaryNode = memo(BoundaryNodeBase);
