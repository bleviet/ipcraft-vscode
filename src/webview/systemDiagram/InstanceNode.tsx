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
import { PinHalo, PinStub } from './PinDecor';
import { unconnectedClass, type NodeReview } from './unconnectedPins';

export type InstanceFlowNode = Node<InstanceNodeData, 'instance'>;

interface PinRowViewProps {
  row: PinRow;
  highlighted: boolean;
  /** Review mode: draw a stub on an unconnected pin. */
  review: boolean;
  focused: boolean;
  onHoverPin?: (target: PinHoverTarget | null, anchor?: DOMRect) => void;
}

function PinRowView({ row, highlighted, review, focused, onHoverPin }: PinRowViewProps) {
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
        side={row.side}
      />
      <span
        className="sd-pin-label"
        data-unconnected={row.unconnected}
        data-class={reviewClass}
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

function unconnectedLabel(review: NodeReview): string {
  return `${review.all} unconnected pins (${review.undriven} undriven, ${review.all - review.undriven} unused)`;
}

export function InstanceNode({ data, selected }: NodeProps<InstanceFlowNode>) {
  const { instance } = data;
  const subtitle = instanceSubtitle(instance, data.cellCount);
  const { review } = data;
  const pinRowView = (row: PinRow) => (
    <PinRowView
      key={row.name}
      row={row}
      highlighted={data.highlightedPins?.has(row.name) ?? false}
      review={review !== undefined}
      focused={data.focusedPin === row.name}
      onHoverPin={data.onHoverPin}
    />
  );
  return (
    <div
      className="sd-node"
      data-kind={instance.kind}
      data-selected={selected}
      data-dimmed={data.dimmed === true}
      {...(review && {
        'data-has-unc': review.all > 0,
        'data-has-undriven': review.undriven > 0,
        'data-unchecked': !review.pinListKnown,
      })}
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
          {review && review.all > 0 ? (
            <span
              className="sd-node-open sd-node-unc"
              data-tone={review.undriven > 0 ? 'undriven' : 'unused'}
              role="img"
              title={unconnectedLabel(review)}
              aria-label={unconnectedLabel(review)}
            >
              <span
                className={`codicon ${review.undriven > 0 ? 'codicon-warning' : 'codicon-debug-disconnect'}`}
              />
              {review.all}
              {instance.kind === 'hier' && <span className="codicon codicon-chevron-right" />}
            </span>
          ) : (
            instance.kind === 'hier' && (
              <span className="sd-node-open" aria-hidden="true">
                OPEN
                <span className="codicon codicon-chevron-right" />
              </span>
            )
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
          {data.west.map(pinRowView)}
        </div>
        <div className="min-w-0 shrink-0" style={{ width: data.eastWidth }}>
          {data.east.map(pinRowView)}
        </div>
      </div>
    </div>
  );
}
