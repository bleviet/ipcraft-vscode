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
export const REMOVE_MIME = 'application/x-ipcraft-remove';
export const PORT_MOVE_MIME = 'application/x-ipcraft-port-move';

export interface RemoveDragPayload {
  action: 'remove';
  kind: string;
  id: string;
}

export interface PortMoveDragPayload {
  portIndex: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseObjectPayload(raw: string): Record<string, unknown> | null {
  try {
    const payload: unknown = JSON.parse(raw);
    return isRecord(payload) ? payload : null;
  } catch {
    return null;
  }
}

function isLibraryDragKind(value: unknown): value is LibraryDragPayload['kind'] {
  switch (value) {
    case 'bus':
    case 'clock':
    case 'reset':
    case 'port':
    case 'parameter':
    case 'interrupt':
      return true;
    default:
      return false;
  }
}

function isDirection(value: unknown): value is NonNullable<LibraryDragPayload['direction']> {
  return value === 'in' || value === 'out' || value === 'inout';
}

function hasOptionalString(payload: Record<string, unknown>, key: string): boolean {
  return !(key in payload) || typeof payload[key] === 'string';
}

/** Parses and validates a library-palette drag payload before it reaches model-edit code. */
export function parseLibraryDragPayload(raw: string): LibraryDragPayload | null {
  const payload = parseObjectPayload(raw);
  if (!payload) {
    return null;
  }

  const { kind, nameHint, label, type, mode, dataType, vendor, direction } = payload;
  if (
    !isLibraryDragKind(kind) ||
    typeof nameHint !== 'string' ||
    typeof label !== 'string' ||
    !hasOptionalString(payload, 'type') ||
    !hasOptionalString(payload, 'mode') ||
    !hasOptionalString(payload, 'dataType') ||
    !hasOptionalString(payload, 'vendor') ||
    ('direction' in payload && !isDirection(direction))
  ) {
    return null;
  }

  const result: LibraryDragPayload = { kind, nameHint, label };
  if (typeof type === 'string') {
    result.type = type;
  }
  if (typeof mode === 'string') {
    result.mode = mode;
  }
  if (typeof dataType === 'string') {
    result.dataType = dataType;
  }
  if (typeof vendor === 'string') {
    result.vendor = vendor;
  }
  if (isDirection(direction)) {
    result.direction = direction;
  }
  return result;
}

/** Parses and validates a canvas-to-remove-zone drag payload. */
export function parseRemoveDragPayload(raw: string): RemoveDragPayload | null {
  const payload = parseObjectPayload(raw);
  if (!payload) {
    return null;
  }

  const { action, kind, id } = payload;
  if (
    action !== 'remove' ||
    typeof kind !== 'string' ||
    kind.length === 0 ||
    typeof id !== 'string' ||
    id.length === 0
  ) {
    return null;
  }

  return { action, kind, id };
}

/** Parses and validates a legacy HTML5 port-to-bus drop payload. */
export function parsePortMoveDragPayload(raw: string): PortMoveDragPayload | null {
  const payload = parseObjectPayload(raw);
  if (!payload) {
    return null;
  }

  const { portIndex } = payload;
  if (typeof portIndex !== 'number' || !Number.isInteger(portIndex) || portIndex < 0) {
    return null;
  }

  return { portIndex };
}

/** Module-level reference to the payload currently being dragged from the palette.
 *  Set on dragstart, cleared on dragend. Readable during dragover across the same page. */
let _activeDragPayload: LibraryDragPayload | null = null;

export function getActiveDragPayload(): LibraryDragPayload | null {
  return _activeDragPayload;
}

export function setActiveDragPayload(payload: LibraryDragPayload | null): void {
  _activeDragPayload = payload;
}
