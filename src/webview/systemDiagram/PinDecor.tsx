import React from 'react';
import type { UnconnectedClass } from './unconnectedPins';

const STUB_LENGTH = 16;
const STUB_WIDTH = STUB_LENGTH + 6;
const HALO_SIZE = 20;

interface PinDecorProps {
  /** Border the pin marker sits on. */
  side: 'west' | 'east';
  /** Same inset as the {@link PinMarker} it decorates. */
  inset?: number;
  top?: number | string;
}

/** Dashed line from the border with a hollow circle at its end, marking a pin without a net. */
export function PinStub({
  cls,
  side,
  inset = 1,
  top = '50%',
}: PinDecorProps & { cls: UnconnectedClass }) {
  const west = side === 'west';
  const color =
    cls === 'undriven'
      ? 'var(--vscode-editorWarning-foreground)'
      : 'var(--vscode-descriptionForeground)';
  const start = west ? STUB_WIDTH : 0;
  const dir = west ? -1 : 1;
  return (
    <svg
      aria-hidden="true"
      className="sd-pin-stub"
      data-class={cls}
      width={STUB_WIDTH}
      height={10}
      style={{ [west ? 'left' : 'right']: -inset - STUB_WIDTH, top, marginTop: -5 }}
    >
      <path
        d={`M${start},5 H${start + dir * STUB_LENGTH}`}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeDasharray="3 2"
      />
      <circle
        cx={start + dir * (STUB_LENGTH + 3)}
        cy={5}
        r={3}
        fill="var(--vscode-editor-background)"
        stroke={color}
        strokeWidth={1.5}
      />
    </svg>
  );
}

/** Focus halo centred on a pin marker, drawn behind it. */
export function PinHalo({ side, inset = 1, top = '50%' }: PinDecorProps) {
  return (
    <span
      aria-hidden="true"
      className="sd-pin-halo"
      style={{
        [side === 'west' ? 'left' : 'right']: -inset - HALO_SIZE / 2,
        top,
        width: HALO_SIZE,
        height: HALO_SIZE,
        marginTop: -HALO_SIZE / 2,
      }}
    />
  );
}

/**
 * Frequency of a clock pin, outside the block next to the wire. It sits above the
 * wire on the east (driving) side, and below it on the west side or where a net
 * badge takes the place above, so the labels at the two ends of a short wire never overlap.
 */
export function PinFrequency({
  text,
  color,
  side,
  hasBadge = false,
  top = '50%',
}: {
  text: string;
  color?: string;
  side: 'west' | 'east';
  hasBadge?: boolean;
  top?: number | string;
}) {
  const wire = typeof top === 'number' ? `${top}px` : top;
  const below = side === 'west' || hasBadge;
  return (
    <span
      className="sd-pin-freq"
      style={{
        [side === 'west' ? 'right' : 'left']: 'calc(100% + 8px)',
        top: below ? `calc(${wire} + 2px)` : `calc(${wire} - 2px)`,
        transform: below ? undefined : 'translateY(-100%)',
        color,
      }}
    >
      {text}
    </span>
  );
}
