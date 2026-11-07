import React from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { PIN_ROW_HEIGHT, type InstanceNodeData, type PinRow } from './layout/elkLayout';
import type { PinMark } from './clocks/nodeView';
import type { PinHoverTarget } from './model';
import { NetBadgeView } from './NetBadgeView';
import { NodeHeader } from './NodeHeader';
import { PinMarker } from './PinMarker';
import { PinFrequency, PinHalo, PinStub } from './PinDecor';
import { unconnectedClass } from './unconnectedPins';

export type InstanceFlowNode = Node<InstanceNodeData, 'instance'>;

interface PinRowViewProps {
  row: PinRow;
  highlighted: boolean;
  /** Review mode: draw a stub on an unconnected pin. */
  review: boolean;
  focused: boolean;
  /** Domain colors, frequency label and crossing end of the pin, when it has any. */
  mark?: PinMark;
  onHoverPin?: (target: PinHoverTarget | null, anchor?: DOMRect) => void;
}

function PinRowView({ row, highlighted, review, focused, mark, onHoverPin }: PinRowViewProps) {
  const east = row.side === 'east';
  const reviewClass = review && row.unconnected ? unconnectedClass(row, false) : undefined;
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
      {focused && <PinHalo side={row.side} />}
      {reviewClass && <PinStub cls={reviewClass} side={row.side} />}
      <PinMarker
        isInterface={row.isInterface}
        category={row.category}
        hollow={row.unconnected}
        color={mark?.color}
        side={row.side}
      />
      {mark?.frequency && (
        <PinFrequency
          text={mark.frequency}
          color={mark.color}
          side={row.side}
          hasBadge={row.badge !== undefined}
        />
      )}
      <span
        className="sd-pin-label"
        data-unconnected={row.unconnected}
        data-class={reviewClass}
        data-highlight={highlighted}
        data-crossing={mark?.crossing}
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
  const { instance, review } = data;
  const pinRowView = (row: PinRow) => (
    <PinRowView
      key={row.name}
      row={row}
      highlighted={data.highlightedPins?.has(row.name) ?? false}
      review={review !== undefined}
      focused={data.focusedPin === row.name}
      mark={data.pinMarks?.[row.name]}
      onHoverPin={data.onHoverPin}
    />
  );
  return (
    <div
      className="sd-node"
      data-kind={instance.kind}
      data-selected={selected}
      data-highlighted={data.highlightColor !== undefined || undefined}
      data-dimmed={data.dimmed === true}
      {...(review && {
        'data-has-unc': review.all > 0,
        'data-has-undriven': review.undriven > 0,
        'data-unchecked': !review.pinListKnown,
      })}
      {...(data.domains && {
        'data-crossing-end': Object.values(data.pinMarks ?? {}).some((mark) => mark.crossing),
      })}
      style={{
        width: data.width,
        ...(data.highlightColor && { '--sd-highlight': data.highlightColor }),
      }}
    >
      {data.flashToken !== undefined && (
        <span
          key={data.flashToken}
          className="sd-flash"
          aria-hidden="true"
          onAnimationEnd={() => data.onFlashEnd?.(data.flashToken as number)}
        />
      )}
      <NodeHeader
        instance={instance}
        cellCount={data.cellCount}
        review={review}
        domains={data.domains}
        expanded={false}
        onToggleExpand={data.onToggleExpand}
      />
      {[...data.west, ...data.east].map(
        (row) =>
          row.badge && (
            <NetBadgeView
              key={`badge:${row.name}`}
              badge={row.badge}
              selectedNetIds={data.selectedNetIds}
              onSelectNet={data.onSelectNet}
            />
          )
      )}
      <div className="flex" style={{ paddingBottom: 10 }}>
        <div className="min-w-0 shrink-0" style={{ width: data.westWidth }}>
          {data.west.map(pinRowView)}
        </div>
        <div className="min-w-0 shrink-0" style={{ width: data.eastWidth }}>
          {data.east.map(pinRowView)}
        </div>
      </div>
    </div>
  );
}
