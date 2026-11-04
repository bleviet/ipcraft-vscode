import React from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { categoryColor } from './colors';
import {
  HEADER_HEIGHT,
  PIN_ROW_HEIGHT,
  type InstanceNodeData,
  type PinRow,
} from './layout/elkLayout';
import { instanceTypeLabel, pinTooltip } from './model';
import { NetBadgeView } from './NetBadgeView';

export type InstanceFlowNode = Node<InstanceNodeData, 'instance'>;

function PinRowView({ row }: { row: PinRow }) {
  const east = row.side === 'east';
  const marker = (
    <span
      aria-hidden="true"
      className={`inline-block h-2 w-2 shrink-0 ${row.isInterface ? '' : 'rounded-full'}`}
      style={{ background: categoryColor(row.category) }}
    />
  );
  return (
    <div
      title={pinTooltip(row, row.netNames)}
      className={`relative flex items-center gap-1 px-2 ${east ? 'flex-row-reverse' : ''}`}
      style={{ height: PIN_ROW_HEIGHT }}
    >
      {marker}
      <span className="truncate">{row.name}</span>
      {(['source', 'target'] as const).map((type) => (
        <Handle
          key={type}
          type={type}
          id={row.name}
          position={east ? Position.Right : Position.Left}
          isConnectable={false}
          className="sd-handle"
        />
      ))}
    </div>
  );
}

export function InstanceNode({ data, selected }: NodeProps<InstanceFlowNode>) {
  const { instance } = data;
  const subtitle =
    instance.kind === 'hier'
      ? `Hierarchy · ${data.cellCount} cells`
      : (instanceTypeLabel(instance) ?? (instance.kind === 'module' ? 'module' : ''));
  return (
    <div className="sd-node" data-selected={selected} data-dimmed={data.dimmed === true}>
      <div className="px-2 py-1" style={{ height: HEADER_HEIGHT }}>
        <div className="truncate font-semibold">{instance.name}</div>
        <div className="truncate opacity-70">{subtitle}</div>
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
        <div className="min-w-0 flex-1">
          {data.west.map((row) => (
            <PinRowView key={row.name} row={row} />
          ))}
        </div>
        <div className="min-w-0 flex-1">
          {data.east.map((row) => (
            <PinRowView key={row.name} row={row} />
          ))}
        </div>
      </div>
    </div>
  );
}
