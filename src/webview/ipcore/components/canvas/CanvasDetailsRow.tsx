import React, { useLayoutEffect, useRef, useState } from 'react';
import type { PacketFormatRefInfo } from '../../../../shared/packetFormat';
import type { LayoutPort } from './canvasLayout';
import { PortTooltip } from './CanvasHud';
import { PacketFormatCallout } from './PacketFormatCallout';
import type { PacketDetailsTarget } from '../../hooks/usePacketDetails';

export interface CanvasDetailsRowProps {
  target: PacketDetailsTarget;
  pinned: boolean;
  ports: LayoutPort[];
  info: PacketFormatRefInfo | undefined;
  onOpen: (relativeFile: string) => void;
}

/**
 * Second row below the IP symbol: the bus info box and its packet format side by side, at equal height. The row
 * never shrinks while open (until the canvas is resized), so switching between buses does not make the symbol jump.
 */
export const CanvasDetailsRow: React.FC<CanvasDetailsRowProps> = ({
  target,
  pinned,
  ports,
  info,
  onOpen,
}) => {
  const rowRef = useRef<HTMLDivElement>(null);
  const [minHeight, setMinHeight] = useState(0);

  useLayoutEffect(() => {
    const row = rowRef.current;
    // Only a row below the symbol moves it; the side column (short canvas) keeps its natural height.
    if (!row || getComputedStyle(row).flexDirection === 'column') {
      return;
    }
    const height = row.offsetHeight;
    if (height > minHeight) {
      setMinHeight(height);
    }
  });

  useLayoutEffect(() => {
    const layout = rowRef.current?.closest('.ip-canvas-layout');
    if (!layout || typeof ResizeObserver === 'undefined') {
      return;
    }
    let first = true;
    const observer = new ResizeObserver(() => {
      if (!first) {
        setMinHeight(0);
      }
      first = false;
    });
    observer.observe(layout);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={rowRef}
      className="ip-canvas-details"
      data-testid="canvas-details"
      style={minHeight ? { minHeight } : undefined}
    >
      <PortTooltip portId={target.portId} ports={ports} />
      <PacketFormatCallout
        busName={target.busName}
        packetRef={target.ref}
        info={info}
        pinned={pinned}
        onOpen={onOpen}
      />
    </div>
  );
};
