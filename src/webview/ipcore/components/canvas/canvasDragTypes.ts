/**
 * Drag-payload types shared between the library palette (drag source) and the
 * canvas (drop target). Kept dependency-neutral so hooks/controllers reading
 * the payload don't need to import the palette component (issue #129).
 */

/** Payload attached to drag events from the library palette */
export interface LibraryDragPayload {
  kind: 'bus' | 'clock' | 'reset' | 'port' | 'parameter' | 'interrupt';
  /** Bus type VLNV (only for kind=bus) */
  type?: string;
  /** Bus mode: slave/master (only for kind=bus) */
  mode?: string;
  /** Port/interrupt direction (only for kind=port or kind=interrupt) */
  direction?: 'in' | 'out' | 'inout';
  /** Generic data type (only for kind=parameter) */
  dataType?: string;
  /** Default name hint */
  nameHint: string;
  /** Display label in the palette */
  label: string;
  /** VLNV vendor segment (only for kind=bus); rendered as a badge. */
  vendor?: string;
}

export const DRAG_MIME = 'application/x-ipcraft-palette';

/** Module-level reference to the payload currently being dragged from the palette.
 *  Set on dragstart, cleared on dragend. Readable during dragover across the same page. */
let _activeDragPayload: LibraryDragPayload | null = null;

export function getActiveDragPayload(): LibraryDragPayload | null {
  return _activeDragPayload;
}

export function setActiveDragPayload(payload: LibraryDragPayload | null): void {
  _activeDragPayload = payload;
}
