import React, { memo } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import type { FrameNodeData, FramePinRow } from './layout/elkLayout';
import type { PinMark } from './clocks/nodeView';
import type { PinHoverTarget } from './model';
import { NetBadgeView } from './NetBadgeView';
import { NodeHeader } from './NodeHeader';
import { PinFrequency, PinHalo, PinStub } from './PinDecor';
import { PinMarker } from './PinMarker';
import { unconnectedClass } from './unconnectedPins';

export type FrameFlowNode = Node<FrameNodeData, 'frame'>;

/** Frame border width; the pin markers are offset by it to sit centred on the border. */
const FRAME_BORDER = 2;
/** Pin box (see `.sd-frame-pin`): it starts 16 px above the pin height and reaches 4 px below it. */
const PIN_BOX_TOP = 16;
const PIN_BOX_HEIGHT = PIN_BOX_TOP + 4;

interface FramePinProps {
  row: FramePinRow;
  highlighted: boolean;
  /** Review mode: draw a stub on an unconnected pin. */
  review: boolean;
  focused: boolean;
  /** Domain colors and frequency label of the pin, when it has any. */
  mark?: PinMark;
  onHoverPin?: (target: PinHoverTarget | null, anchor?: DOMRect) => void;
}

/** One pin of the frame: marker on the border, label inside just above the inner wire. */
function FramePin({ row, highlighted, review, focused, mark, onHoverPin }: FramePinProps) {
  const east = row.side === 'east';
  const reviewClass = review && row.unconnected ? unconnectedClass(row, false) : undefined;
  const place = { inset: FRAME_BORDER, top: PIN_BOX_TOP };
  return (
    <>
      <div
        className="sd-frame-pin"
        data-side={row.side}
        aria-label={row.label === row.name ? undefined : row.name}
        style={{ top: row.y - PIN_BOX_TOP, height: PIN_BOX_HEIGHT, [east ? 'right' : 'left']: 0 }}
        onPointerEnter={(event) =>
          onHoverPin?.(
            { pin: row, netNames: row.netNames, side: row.side },
            event.currentTarget.getBoundingClientRect()
          )
        }
        onPointerLeave={() => onHoverPin?.(null)}
      >
        {focused && <PinHalo side={row.side} {...place} />}
        {reviewClass && <PinStub cls={reviewClass} side={row.side} {...place} />}
        <PinMarker
          isInterface={row.isInterface}
          category={row.category}
          hollow={row.unconnected}
          color={mark?.color}
          side={row.side}
          {...place}
        />
        {mark?.frequency && (
          <PinFrequency
            text={mark.frequency}
            color={mark.color}
            side={row.side}
            hasBadge={row.badge !== undefined}
            top={PIN_BOX_TOP}
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
      </div>
      {(['source', 'target'] as const).map((type) => (
        <Handle
          key={type}
          type={type}
          id={row.name}
          position={east ? Position.Right : Position.Left}
          isConnectable={false}
          className="sd-handle"
          style={{ top: row.y, [east ? 'right' : 'left']: -FRAME_BORDER }}
        />
      ))}
    </>
  );
}

/** An expanded hierarchy block: a frame with the header on top and its pins on the border. */
function FrameNodeBase({ data, selected, width, height }: NodeProps<FrameFlowNode>) {
  const { instance, review } = data;
  const rows = [...data.west, ...data.east];
  return (
    <div
      className="sd-frame"
      data-selected={selected}
      data-highlighted={data.highlightColor !== undefined || undefined}
      {...(review && {
        'data-has-unc': review.all > 0,
        'data-has-undriven': review.undriven > 0,
      })}
      style={{
        width,
        height,
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
        expanded
        onToggleExpand={data.onToggleExpand}
      />
      {rows.map(
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
      {rows.map((row) => (
        <FramePin
          key={row.name}
          row={row}
          highlighted={data.highlightedPins?.has(row.name) ?? false}
          review={review !== undefined}
          focused={data.focusedPin === row.name}
          mark={data.pinMarks?.[row.name]}
          onHoverPin={data.onHoverPin}
        />
      ))}
    </div>
  );
}

/** Memoized: React Flow re-renders a node only when its data object changes. */
export const FrameNode = memo(FrameNodeBase);
