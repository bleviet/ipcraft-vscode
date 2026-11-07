import React from 'react';
import { Handle, Position } from '@xyflow/react';
import { PIN_ROW_HEIGHT, type PinRow } from './layout/elkLayout';
import { groupPinMark, type PinMarks } from './clocks/nodeView';
import type { PinHoverTarget } from './model';
import { PinMarker } from './PinMarker';
import { PinFrequency, PinHalo, PinStub } from './PinDecor';
import { unconnectedClass, type UnconnectedClass } from './unconnectedPins';

interface PinGroupRowProps {
  /** A row with `group`: the folded row of a numbered pin array, or the header of an open one. */
  row: PinRow;
  highlighted: boolean;
  /** Review mode: draw a stub when a member is unconnected. */
  review: boolean;
  focusedPin?: string;
  pinMarks?: PinMarks;
  onToggle: () => void;
  onHoverPin?: (target: PinHoverTarget | null, anchor?: DOMRect) => void;
}

/** `undriven` when an unconnected member is, else `unused`; undefined when every member is connected. */
function reviewClassOf(members: readonly PinRow[]): UnconnectedClass | undefined {
  const unconnected = members.filter((member) => member.unconnected);
  if (unconnected.length === 0) {
    return undefined;
  }
  return unconnected.some((member) => unconnectedClass(member, false) === 'undriven')
    ? 'undriven'
    : 'unused';
}

/**
 * A numbered pin array drawn as one row. Folded, it holds the ports of the array
 * (one handle pair, named by the group); open, it is only the header above the
 * member rows. Everything it shows of the members is aggregated, never sized.
 */
export function PinGroupRow({
  row,
  highlighted,
  review,
  focusedPin,
  pinMarks,
  onToggle,
  onHoverPin,
}: PinGroupRowProps) {
  const { group } = row;
  if (!group) {
    return null;
  }
  const east = row.side === 'east';
  const folded = !group.open;
  const memberNames = group.members.map((member) => member.name);
  const focused =
    focusedPin !== undefined && (focusedPin === row.name || memberNames.includes(focusedPin));
  const reviewClass = review && folded ? reviewClassOf(group.members) : undefined;
  const mark = folded ? groupPinMark(pinMarks, memberNames) : undefined;
  const chevron = (
    <span
      aria-hidden="true"
      className={`codicon codicon-chevron-${folded ? 'right' : 'down'} sd-pin-chevron`}
    />
  );
  return (
    <div
      role="button"
      aria-label={row.label === group.label ? undefined : group.label}
      tabIndex={0}
      aria-expanded={group.open}
      className={`sd-pin-group relative flex items-center ${east ? 'justify-end pr-[9px]' : 'pl-[9px]'}`}
      style={{ height: PIN_ROW_HEIGHT }}
      onClick={(event) => {
        event.stopPropagation();
        onToggle();
      }}
      onDoubleClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          event.stopPropagation();
          onToggle();
        }
      }}
      onPointerEnter={(event) =>
        onHoverPin?.(
          { pin: { ...row, name: group.label }, netNames: row.netNames, side: row.side },
          event.currentTarget.getBoundingClientRect()
        )
      }
      onPointerLeave={() => onHoverPin?.(null)}
    >
      {folded && focused && <PinHalo side={row.side} />}
      {reviewClass && <PinStub cls={reviewClass} side={row.side} />}
      {folded && (
        <PinMarker
          isInterface={row.isInterface}
          category={row.category}
          hollow={row.unconnected}
          color={mark?.color}
          side={row.side}
        />
      )}
      {mark?.frequency && (
        <PinFrequency text={mark.frequency} color={mark.color} side={row.side} hasBadge={false} />
      )}
      {!east && chevron}
      <span
        className="sd-pin-label"
        data-unconnected={folded && row.unconnected}
        data-class={reviewClass}
        data-highlight={highlighted}
        data-crossing={mark?.crossing}
      >
        {row.label}
      </span>
      {east && chevron}
      {folded &&
        (['source', 'target'] as const).map((type) => (
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
