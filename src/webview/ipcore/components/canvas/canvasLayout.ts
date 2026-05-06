import type { IpCore, Clock, Reset, Port, BusInterface } from '../../../types/ipCore';

// --- Constants ---

/** Vertical spacing between port stubs */
export const PORT_PITCH = 36;

/** Padding above the first port and below the last */
export const EDGE_PADDING = 24;

/** Minimum block height (even with zero ports) */
export const MIN_BLOCK_HEIGHT = 120;

/** Horizontal block width */
export const BLOCK_WIDTH = 280;

/** How far port stubs extend from the block edge */
export const STUB_LENGTH = 48;

/** Horizontal margin around the block (for stub space + labels) */
export const CANVAS_MARGIN_X = 180;

/** Vertical margin above/below the block */
export const CANVAS_MARGIN_Y = 40;

// --- Types ---

export type PortKind = 'clock' | 'reset' | 'port' | 'bus';
export type PortSide = 'left' | 'right' | 'bottom';

export interface LayoutPort {
  /** Stable identifier: `clock:0`, `reset:1`, `port:3`, `bus:2` */
  id: string;
  x: number;
  y: number;
  side: PortSide;
  kind: PortKind;
  label: string;
  widthLabel: string;
  /** For buses: protocol short name and mode badge */
  protocol?: string;
  mode?: string;
  /** Original data reference */
  data: Clock | Reset | Port | BusInterface;
}

export interface CanvasLayout {
  /** The central block rectangle (in canvas coordinates) */
  blockRect: { x: number; y: number; width: number; height: number };
  /** All ports positioned around the block */
  ports: LayoutPort[];
  /** Total canvas size needed (for the SVG viewBox) */
  viewBox: { width: number; height: number };
  /** Core display name */
  coreName: string;
  /** VLNV subtitle */
  vlnvLabel: string;
}

// --- Helpers ---

function formatWidth(w: number | string | undefined): string {
  if (w === undefined || w === 1) {
    return '';
  }
  if (typeof w === 'string') {
    return `[${w}]`;
  }
  return `[${w - 1}:0]`;
}

function busProtocolShortName(busType: string): string {
  const lower = busType.toLowerCase();
  if (lower.includes('axi4_lite') || lower.includes('axi4-lite')) {
    return 'AXI4-Lite';
  }
  if (lower.includes('axi4_full') || lower.includes('axi4-full') || lower.includes('axi4.')) {
    return 'AXI4';
  }
  if (lower.includes('axi_stream') || lower.includes('axi-stream') || lower.includes('axi4s')) {
    return 'AXI-Stream';
  }
  if (lower.includes('avalon_mm') || lower.includes('avalon-mm')) {
    return 'Avalon-MM';
  }
  if (lower.includes('avalon_st') || lower.includes('avalon-st')) {
    return 'Avalon-ST';
  }
  // Fallback: use the last segment of the VLNV
  const parts = busType.split('.');
  return parts[parts.length - 2] ?? busType;
}

function modeLabel(mode: string): string {
  switch (mode) {
    case 'slave':
      return 'S';
    case 'master':
      return 'M';
    case 'sink':
      return 'Sink';
    case 'source':
      return 'Src';
    default:
      return mode;
  }
}

/** Returns true if this interface belongs on the left side (slave/sink/input-like) */
function isLeftSide(bus: BusInterface): boolean {
  return bus.mode === 'slave' || bus.mode === 'sink';
}

function isInputDirection(dir: string | undefined): boolean {
  return dir === 'in' || dir === undefined;
}

// --- Main layout function ---

/**
 * Compute spatial positions for every port/bus around the IP core block.
 *
 * Placement rules:
 *  Left edge (top to bottom): clocks, resets, slave/sink buses, input ports
 *  Right edge (top to bottom): master/source buses, output ports
 *  Bottom edge: bidirectional ports
 */
export function computeLayout(ipCore: IpCore): CanvasLayout {
  const clocks = ipCore.clocks ?? [];
  const resets = ipCore.resets ?? [];
  const ports = ipCore.ports ?? [];
  const buses = ipCore.busInterfaces ?? [];

  // Classify ports by side
  const leftItems: Array<{
    kind: PortKind;
    index: number;
    data: Clock | Reset | Port | BusInterface;
  }> = [];
  const rightItems: Array<{
    kind: PortKind;
    index: number;
    data: Clock | Reset | Port | BusInterface;
  }> = [];
  const bottomItems: Array<{
    kind: PortKind;
    index: number;
    data: Clock | Reset | Port | BusInterface;
  }> = [];

  // Clocks -> left
  clocks.forEach((c, i) => leftItems.push({ kind: 'clock', index: i, data: c }));

  // Resets -> left
  resets.forEach((r, i) => leftItems.push({ kind: 'reset', index: i, data: r }));

  // Bus interfaces -> left (slave/sink) or right (master/source)
  buses.forEach((b, i) => {
    if (isLeftSide(b)) {
      leftItems.push({ kind: 'bus', index: i, data: b });
    } else {
      rightItems.push({ kind: 'bus', index: i, data: b });
    }
  });

  // User ports -> left (in), right (out), bottom (inout)
  ports.forEach((p, i) => {
    if (p.direction === 'inout') {
      bottomItems.push({ kind: 'port', index: i, data: p });
    } else if (isInputDirection(p.direction)) {
      leftItems.push({ kind: 'port', index: i, data: p });
    } else {
      rightItems.push({ kind: 'port', index: i, data: p });
    }
  });

  // Compute block height from the tallest side
  const maxSideCount = Math.max(leftItems.length, rightItems.length, 1);
  const blockHeight = Math.max(MIN_BLOCK_HEIGHT, maxSideCount * PORT_PITCH + EDGE_PADDING * 2);

  // Block width may expand for bottom ports
  const bottomWidth = bottomItems.length * PORT_PITCH + EDGE_PADDING * 2;
  const blockWidth = Math.max(BLOCK_WIDTH, bottomWidth);

  // Block position (centered horizontally in the canvas)
  const blockX = CANVAS_MARGIN_X;
  const blockY = CANVAS_MARGIN_Y;

  // Position side ports
  const layoutPorts: LayoutPort[] = [];

  const positionSide = (items: typeof leftItems, side: PortSide, baseX: number) => {
    const totalHeight = items.length * PORT_PITCH;
    const startY = blockY + (blockHeight - totalHeight) / 2 + PORT_PITCH / 2;

    items.forEach((item, idx) => {
      const y = startY + idx * PORT_PITCH;
      const id = `${item.kind}:${item.index}`;

      let label = '';
      let widthLabel = '';
      let protocol: string | undefined;
      let mode: string | undefined;

      switch (item.kind) {
        case 'clock':
          label = (item.data as Clock).name;
          widthLabel = '';
          break;
        case 'reset':
          label = (item.data as Reset).name;
          widthLabel = '';
          break;
        case 'port':
          label = (item.data as Port).name;
          widthLabel = formatWidth((item.data as Port).width);
          break;
        case 'bus':
          label = (item.data as BusInterface).name;
          protocol = busProtocolShortName((item.data as BusInterface).type);
          mode = modeLabel((item.data as BusInterface).mode);
          widthLabel = '';
          break;
      }

      layoutPorts.push({
        id,
        x: baseX,
        y,
        side,
        kind: item.kind,
        label,
        widthLabel,
        protocol,
        mode,
        data: item.data,
      });
    });
  };

  positionSide(leftItems, 'left', blockX);
  positionSide(rightItems, 'right', blockX + blockWidth);

  // Position bottom ports
  if (bottomItems.length > 0) {
    const totalWidth = bottomItems.length * PORT_PITCH;
    const startX = blockX + (blockWidth - totalWidth) / 2 + PORT_PITCH / 2;
    const baseY = blockY + blockHeight;

    bottomItems.forEach((item, idx) => {
      const x = startX + idx * PORT_PITCH;
      const id = `${item.kind}:${item.index}`;
      const p = item.data as Port;

      layoutPorts.push({
        id,
        x,
        y: baseY,
        side: 'bottom',
        kind: item.kind,
        label: p.name,
        widthLabel: formatWidth(p.width),
        data: item.data,
      });
    });
  }

  // Canvas size
  const viewWidth = blockX + blockWidth + CANVAS_MARGIN_X;
  const viewHeight =
    blockY + blockHeight + CANVAS_MARGIN_Y + (bottomItems.length > 0 ? STUB_LENGTH + 40 : 0);

  // Labels
  const vlnv = ipCore.vlnv;
  const coreName = vlnv.name;
  const vlnvLabel = `${vlnv.vendor}:${vlnv.library}:${vlnv.name}:${vlnv.version}`;

  return {
    blockRect: { x: blockX, y: blockY, width: blockWidth, height: blockHeight },
    ports: layoutPorts,
    viewBox: { width: viewWidth, height: viewHeight },
    coreName,
    vlnvLabel,
  };
}
