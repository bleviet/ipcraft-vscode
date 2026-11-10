import { useCallback, useEffect, useState } from 'react';

export interface PacketDetailsTarget {
  /** Canvas id of the bus bundle, `bus:<index>`. */
  portId: string;
  ref: string;
  busName: string;
}

interface BusLike {
  name: string;
  packetFormatRef?: string | null;
}

/** The bus behind a canvas id, if it is a bus interface with a packet format. */
export function packetDetailsTarget(
  id: string | null,
  busInterfaces: readonly BusLike[] | undefined
): PacketDetailsTarget | null {
  const match = id ? /^bus:(\d+)$/.exec(id) : null;
  const bus = match ? busInterfaces?.[Number(match[1])] : undefined;
  return id && bus?.packetFormatRef
    ? { portId: id, ref: bus.packetFormatRef, busName: bus.name }
    : null;
}

/**
 * Which bus the canvas details row shows. Hovering a stream bus with a packet format shows it; the row then stays
 * on that bus after the pointer leaves the bundle until `clearPreview` is called, typically when the pointer leaves
 * the canvas. (Opening the row shrinks the canvas; `useResizeAnchor` keeps the bundle under the pointer.) A selected bus
 * takes over when nothing is hovered and is shown `pinned`; changing the selection or pressing Escape ends the preview.
 */
export function usePacketDetails(
  hoveredId: string | null,
  selectedId: string | null,
  busInterfaces: readonly BusLike[] | undefined
) {
  const [stickyId, setStickyId] = useState<string | null>(null);
  const hovered = packetDetailsTarget(hoveredId, busInterfaces);
  const selected = packetDetailsTarget(selectedId, busInterfaces);

  const hoveredPortId = hovered?.portId;
  useEffect(() => {
    if (hoveredPortId) {
      setStickyId(hoveredPortId);
    }
  }, [hoveredPortId]);
  // A new selection (or deselection) ends the preview, so deselecting closes the row.
  useEffect(() => setStickyId(null), [selectedId]);

  // Escape dismisses a hover preview (WCAG 1.4.13); a pinned (selected) bus is closed by deselecting it.
  useEffect(() => {
    if (!stickyId) {
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setStickyId(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [stickyId]);

  const target = hovered ?? selected ?? packetDetailsTarget(stickyId, busInterfaces);
  const clearPreview = useCallback(() => setStickyId(null), []);
  return { target, pinned: target !== null && target.portId === selectedId, clearPreview };
}
