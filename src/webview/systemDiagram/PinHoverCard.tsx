import React, { useLayoutEffect, useRef, useState } from 'react';
import { placeHoverCard } from './layout/hoverPlacement';
import { pinHoverLines } from './model';
import type { PinHover } from './hooks/usePinHover';

/** Instant, themed replacement for the native tooltip; fixed so it ignores canvas zoom. */
export function PinHoverCard({ hover }: { hover: PinHover }) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const box = ref.current?.getBoundingClientRect();
    if (box) {
      setSize({ width: box.width, height: box.height });
    }
  }, [hover]);
  const { target, anchor } = hover;
  const [name, ...rest] = pinHoverLines(target.pin, target.netNames);
  const position = placeHoverCard(anchor, target.side, size, {
    width: window.innerWidth,
    height: window.innerHeight,
  });
  return (
    <div
      ref={ref}
      role="tooltip"
      className="pointer-events-none fixed z-50 px-2 py-1"
      style={{
        ...position,
        width: 'max-content',
        maxWidth: 360,
        fontSize: 11,
        overflowWrap: 'anywhere',
        color: 'var(--vscode-editorHoverWidget-foreground, var(--vscode-foreground))',
        background:
          'var(--vscode-editorHoverWidget-background, var(--vscode-editorWidget-background))',
        border:
          '1px solid var(--vscode-editorHoverWidget-border, var(--vscode-editorWidget-border, var(--vscode-panel-border)))',
      }}
    >
      <div className="font-semibold">{name}</div>
      {rest.map((line, index) => (
        <div key={index}>{line}</div>
      ))}
    </div>
  );
}
