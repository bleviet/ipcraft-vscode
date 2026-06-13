import { useCallback } from 'react';
import type { YamlUpdateHandler } from '../../types/editor';
import type { IpCore, Clock, Reset, Port, BusInterface, Interrupt } from '../../types/ipCore';
import { DRAG_MIME, type LibraryDragPayload } from '../components/canvas/LibraryPalette';
import { BLOCK_WIDTH } from '../components/canvas/canvasLayout';

/**
 * Generates a unique name by appending `_N` if the base name already exists.
 * If the base already ends in `_N` (e.g. `port_0`), the numeric suffix is
 * stripped to produce a clean stem (`port`) so subsequent names are
 * `port_1`, `port_2`, … instead of `port_0_0`, `port_0_1`, …
 */
function uniqueName(base: string, existing: string[]): string {
  if (!existing.includes(base)) {
    return base;
  }
  const suffixMatch = base.match(/^(.+)_(\d+)$/);
  const stem = suffixMatch ? suffixMatch[1] : base;
  let i = 0;
  while (existing.includes(`${stem}_${i}`)) {
    i++;
  }
  return `${stem}_${i}`;
}

interface UseCanvasDropOptions {
  ipCore: IpCore;
  onUpdate: YamlUpdateHandler;
  /** Called after element is added, with the new element's canvas ID */
  onSelect: (id: string) => void;
}

/**
 * Hook that handles drop events on the canvas SVG.
 *
 * When a library palette item is dropped:
 * 1. Parses the drag payload
 * 2. Determines placement side from drop position
 * 3. Generates a unique default name
 * 4. Appends the element to the correct array via onUpdate
 * 5. Auto-selects the new element
 */
export function useCanvasDrop({ ipCore, onUpdate, onSelect }: UseCanvasDropOptions) {
  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (e.dataTransfer.types.includes(DRAG_MIME)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    }
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      const raw = e.dataTransfer.getData(DRAG_MIME);
      if (!raw) {
        return;
      }

      e.preventDefault();
      e.stopPropagation();

      let payload: LibraryDragPayload;
      try {
        payload = JSON.parse(raw) as LibraryDragPayload;
      } catch {
        return;
      }

      // Determine drop side from mouse position relative to the SVG canvas midpoint.
      // The SVG viewBox is centered with the block at CANVAS_MARGIN_X, width BLOCK_WIDTH.
      const svg = (e.target as Element).closest('svg');
      if (!svg) {
        return;
      }
      const rect = svg.getBoundingClientRect();
      const relativeX = (e.clientX - rect.left) / rect.width;
      const isLeftHalf = relativeX < 0.5;

      switch (payload.kind) {
        case 'clock':
          addClock(payload, ipCore, onUpdate, onSelect);
          break;
        case 'reset':
          addReset(payload, ipCore, onUpdate, onSelect);
          break;
        case 'bus':
          addBusInterface(payload, isLeftHalf, ipCore, onUpdate, onSelect);
          break;
        case 'port':
          addPort(payload, isLeftHalf, ipCore, onUpdate, onSelect);
          break;
        case 'interrupt':
          addInterrupt(payload, isLeftHalf, ipCore, onUpdate, onSelect);
          break;
        case 'parameter':
          addParameter(payload, ipCore, onUpdate, onSelect);
          break;
      }
    },
    [ipCore, onUpdate, onSelect]
  );

  return { handleDragOver, handleDrop };
}

// Suppress unused variable lint -- BLOCK_WIDTH imported for documentation context
void BLOCK_WIDTH;

function addClock(
  payload: LibraryDragPayload,
  ipCore: IpCore,
  onUpdate: YamlUpdateHandler,
  onSelect: (id: string) => void
) {
  const clocks: Clock[] = [...(ipCore.clocks ?? [])];
  const existingNames = clocks.map((c) => c.name);
  const name = uniqueName(payload.nameHint, existingNames);

  clocks.push({ name });
  onUpdate(['clocks'], clocks);
  onSelect(`clock:${clocks.length - 1}`);
}

function addReset(
  payload: LibraryDragPayload,
  ipCore: IpCore,
  onUpdate: YamlUpdateHandler,
  onSelect: (id: string) => void
) {
  const resets: Reset[] = [...(ipCore.resets ?? [])];
  const existingNames = resets.map((r) => r.name);
  const name = uniqueName(payload.nameHint, existingNames);

  resets.push({ name, polarity: 'activeLow' });
  onUpdate(['resets'], resets);
  onSelect(`reset:${resets.length - 1}`);
}

function addBusInterface(
  payload: LibraryDragPayload,
  isLeftHalf: boolean,
  ipCore: IpCore,
  onUpdate: YamlUpdateHandler,
  onSelect: (id: string) => void
) {
  const buses: BusInterface[] = [...(ipCore.busInterfaces ?? [])];
  const existingNames = buses.map((b) => b.name);

  // If dropped on the "wrong" side, flip the mode
  let mode = payload.mode ?? 'slave';
  if (isLeftHalf && (mode === 'master' || mode === 'source')) {
    mode = 'slave';
  } else if (!isLeftHalf && (mode === 'slave' || mode === 'sink')) {
    mode = 'master';
  }

  const name = uniqueName(payload.nameHint, existingNames);
  const prefix = `${name}_`;

  const newBus: BusInterface = {
    name,
    type: payload.type ?? '',
    mode: mode as BusInterface['mode'],
    physicalPrefix: prefix,
  };

  // Auto-associate first available clock/reset if they exist
  if (ipCore.clocks?.length) {
    newBus.associatedClock = ipCore.clocks[0].name;
  }
  if (ipCore.resets?.length) {
    newBus.associatedReset = ipCore.resets[0].name;
  }

  buses.push(newBus);
  onUpdate(['busInterfaces'], buses);
  onSelect(`bus:${buses.length - 1}`);
}

function addParameter(
  payload: LibraryDragPayload,
  ipCore: IpCore,
  onUpdate: YamlUpdateHandler,
  onSelect: (id: string) => void
) {
  const params = [...((ipCore.parameters ?? []) as unknown as Array<Record<string, unknown>>)];
  const existingNames = params.map((p) => String(p.name ?? ''));
  const name = uniqueName(payload.nameHint, existingNames);

  const defaultValues: Record<string, unknown> = {
    integer: 0,
    boolean: false,
    string: '',
  };
  const dataType = payload.dataType ?? 'integer';
  const newParam = { name, dataType, defaultValue: defaultValues[dataType] ?? 0 };

  params.push(newParam);
  onUpdate(['parameters'], params);
  onSelect(`parameter:${params.length - 1}`);
}

function addPort(
  payload: LibraryDragPayload,
  isLeftHalf: boolean,
  ipCore: IpCore,
  onUpdate: YamlUpdateHandler,
  onSelect: (id: string) => void
) {
  const ports: Port[] = [...(ipCore.ports ?? [])];
  const existingNames = ports.map((p) => p.name);
  const name = uniqueName(payload.nameHint, existingNames);

  // Infer direction from drop position if payload doesn't specify
  // inout stays inout regardless of drop side
  let direction = payload.direction ?? (isLeftHalf ? 'in' : 'out');
  if (direction !== 'inout') {
    if (isLeftHalf && direction === 'out') {
      direction = 'in';
    } else if (!isLeftHalf && direction === 'in') {
      direction = 'out';
    }
  }

  const newPort: Port = {
    name,
    direction: direction as Port['direction'],
    width: 1,
  };

  ports.push(newPort);
  onUpdate(['ports'], ports);
  onSelect(`port:${ports.length - 1}`);
}

function addInterrupt(
  payload: LibraryDragPayload,
  isLeftHalf: boolean,
  ipCore: IpCore,
  onUpdate: YamlUpdateHandler,
  onSelect: (id: string) => void
) {
  const interrupts: Interrupt[] = [...((ipCore.interrupts ?? []) as Interrupt[])];
  const existingNames = interrupts.map((irq) => irq.name);
  const name = uniqueName(payload.nameHint, existingNames);
  const direction = payload.direction ?? (isLeftHalf ? 'in' : 'out');

  const newInterrupt: Interrupt = {
    name,
    direction,
    sensitivity: 'LEVEL_HIGH',
  };

  interrupts.push(newInterrupt);
  onUpdate(['interrupts'], interrupts);
  onSelect(`interrupt:${interrupts.length - 1}`);
}
