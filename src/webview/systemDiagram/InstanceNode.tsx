import React from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import {
  HEADER_HEIGHT,
  PIN_ROW_HEIGHT,
  type InstanceNodeData,
  type PinRow,
} from './layout/elkLayout';
import { instanceSubtitle, type PinHoverTarget } from './model';
import { NetBadgeView } from './NetBadgeView';
import { PinMarker } from './PinMarker';

export type InstanceFlowNode = Node<InstanceNodeData, 'instance'>;

interface PinRowViewProps {
  row: PinRow;
  highlighted: boolean;
  onHoverPin?: (target: PinHoverTarget | null, anchor?: DOMRect) => void;
}

function PinRowView({ row, highlighted, onHoverPin }: PinRowViewProps) {
  const east = row.side === 'east';
  return (
    <div
      aria-label={row.label === row.name ? undefined : row.name}
      onPointerEnter={(event) =>
        onHoverPin?.(
          { pin: row, netNames: row.netNames, side: row.side },
          event.currentTarget.getBoundingClientRect()
        )
      }
      onPointerLeave={() => onHoverPin?.(null)}
      className={`relative flex items-center ${east ? 'justify-end pr-[9px]' : 'pl-[9px]'}`}
      style={{ height: PIN_ROW_HEIGHT }}
    >
      <PinMarker
        isInterface={row.isInterface}
        category={row.category}
        hollow={row.unconnected}
        side={row.side}
      />
      <span
        className="sd-pin-label"
        data-unconnected={row.unconnected}
        data-highlight={highlighted}
      >
        {row.label}
      </span>
      {(['source', 'target'] as const).map((type) => (
        <Handle
          key={type}
          type={type}
          id={row.name}
          position={east ? Position.Right : Position.Left}
          isConnectable={false}
          className="sd-handle"
          style={{ [east ? 'right' : 'left']: -1 }}
        />
      ))}
    </div>
  );
}

export function InstanceNode({ data, selected }: NodeProps<InstanceFlowNode>) {
  const { instance } = data;
  const subtitle = instanceSubtitle(instance, data.cellCount);
  return (
    <div
      className="sd-node"
      data-kind={instance.kind}
      data-selected={selected}
      data-dimmed={data.dimmed === true}
      style={{ width: data.width }}
    >
      {data.flashToken !== undefined && (
        <span
          key={data.flashToken}
          className="sd-flash"
          aria-hidden="true"
          onAnimationEnd={() => data.onFlashEnd?.(data.flashToken as number)}
        />
      )}
      <div className="sd-node-head" style={{ height: HEADER_HEIGHT }}>
        <div className="sd-node-title">
          <span className="sd-node-name">{instance.name}</span>
          {instance.kind === 'hier' && (
            <span className="sd-node-open" aria-hidden="true">
              OPEN
              <span className="codicon codicon-chevron-right" />
            </span>
          )}
        </div>
        <div className="sd-node-subtitle">{subtitle}</div>
      </div>
      {[...data.west, ...data.east].map(
        (row) =>
          row.badge && (
            <NetBadgeView
              key={`badge:${row.name}`}
              badge={row.badge}
              onSelectNet={data.onSelectNet}
            />
          )
      )}
      <div className="flex" style={{ paddingBottom: 10 }}>
        <div className="min-w-0 shrink-0" style={{ width: data.westWidth }}>
          {data.west.map((row) => (
            <PinRowView
              key={row.name}
              row={row}
              highlighted={data.highlightedPins?.has(row.name) ?? false}
              onHoverPin={data.onHoverPin}
            />
          ))}
        </div>
        <div className="min-w-0 shrink-0" style={{ width: data.eastWidth }}>
          {data.east.map((row) => (
            <PinRowView
              key={row.name}
              row={row}
              highlighted={data.highlightedPins?.has(row.name) ?? false}
              onHoverPin={data.onHoverPin}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
