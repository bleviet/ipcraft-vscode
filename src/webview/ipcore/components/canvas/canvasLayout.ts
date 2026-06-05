import type { IpCore, BusInterface, Interrupt } from '../../../types/ipCore';
import type { BusPortDef } from '../../data/busDefinitions';

// --- Constants ---

/** Vertical spacing between port stubs */
export const PORT_PITCH = 36;

/** Description section geometry */
const DESC_CHARS_PER_LINE = 36;
const DESC_LINE_HEIGHT = 13;
const DESC_PADDING_TOP = 10;
const DESC_PADDING_BOTTOM = 12;

/** Padding above the first port and below the last */
export const EDGE_PADDING = 24;

/**
 * Minimum Y-offset (relative to blockY) at which the first port may be placed.
 * The block header contains the core name (y+15) and VLNV subtitle (y+42, 9 px font,
 * bottom ≈ y+47).  56 keeps a comfortable gap below that text.
 */
const BLOCK_HEADER_HEIGHT = 56;

/** Minimum block height (even with zero ports) */
export const MIN_BLOCK_HEIGHT = 120;

/** Horizontal block width */
export const BLOCK_WIDTH = 280;

/** How far port stubs extend from the block edge */
export const STUB_LENGTH = 48;

/** Horizontal margin around the block (for stub space + labels) */
export const CANVAS_MARGIN_X = 280;

/** Vertical margin above/below the block */
export const CANVAS_MARGIN_Y = 40;

// --- Types ---

export type PortKind = 'clock' | 'reset' | 'port' | 'bus' | 'interrupt';
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
  /** For array buses: replication count (>1 means this interface is an array) */
  arrayCount?: number;
  /** For single slave memory-mapped buses: the assigned memory map name */
  memoryMapRef?: string;
  /** Signal direction (absent for bus bundles — use mode badge instead) */
  direction?: 'in' | 'out' | 'inout';
  /** Original data reference */
  data: unknown;
  /** Index into ipCore.clocks for this port's clock domain, or -1 */
  clockDomainIdx: number;
}

/** A dependency entry rendered inside the block body */
export interface LayoutSubcoreDep {
  /** Index into ipCore.subcores */
  index: number;
  /** Full VLNV string, e.g. `xilinx.com:ip:fifo_generator:13.2` */
  vlnv: string;
  /** Short display name: just the name segment of the VLNV */
  shortName: string;
  /** Absolute Y centre of this row in canvas coordinates */
  y: number;
}

/** An individual signal port of an expanded bus interface */
export interface LayoutSubPort {
  /** Stable ID: `bus:0:AWADDR` */
  id: string;
  /** ID of the parent bus bundle: `bus:0` */
  parentBusId: string;
  x: number;
  y: number;
  side: PortSide;
  /** Logical signal name, e.g. `AWADDR` */
  name: string;
  /** Width label e.g. `[31:0]` or empty string */
  widthLabel: string;
  direction?: 'in' | 'out' | 'inout';
  presence: 'required' | 'optional';
  /** true = required port OR optional port in useOptionalPorts */
  active: boolean;
  /** Physical port prefix from the bus interface (e.g. `s_axi_`) */
  physicalPrefix: string;
  /** Overridden physical suffix when portNameOverrides applies; falls back to name.toLowerCase() */
  physicalSuffix?: string;
  /** Index into ipCore.clocks for this signal's clock domain, or -1 */
  clockDomainIdx: number;
}

/** A generic/parameter rendered inside the block body */
export interface LayoutParameter {
  index: number;
  name: string;
  /** Formatted default value, e.g. "32" or empty string */
  value: string;
}

export interface CanvasLayout {
  /** The central block rectangle (in canvas coordinates) */
  blockRect: { x: number; y: number; width: number; height: number };
  /** All ports positioned around the block */
  ports: LayoutPort[];
  /** Individual signals for expanded bus interfaces */
  subPorts: LayoutSubPort[];
  /** Total canvas size needed (for the SVG viewBox) */
  viewBox: { width: number; height: number };
  /** Core display name */
  coreName: string;
  /** VLNV subtitle */
  vlnvLabel: string;
  /** Generics rendered inside the block, below the separator */
  parameters: LayoutParameter[];
  /** Y of separator line above the generics section (only rendered when parameters.length > 0) */
  paramSeparatorY: number;
  /** Y of separator line below the generics section, above where ports start (only rendered when parameters.length > 0) */
  portSeparatorY: number;
  /** Wrapped description lines (empty when no description) */
  descLines: string[];
  /** Y of separator above the description section (only relevant when descLines is non-empty) */
  descSeparatorY: number;
  /** Dependency subcores rendered inside the block, above the parameters section */
  subcoreDeps: LayoutSubcoreDep[];
  /** Y of separator line above the subcores section (only rendered when subcoreDeps.length > 0) */
  depSeparatorY: number;
}

// --- Helpers ---

function wrapText(text: string, maxChars: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    if (!current) {
      current = word;
    } else if (current.length + 1 + word.length <= maxChars) {
      current += ' ' + word;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) {
    lines.push(current);
  }
  return lines;
}

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
  if (lower.includes('conduit')) {
    return 'Custom';
  }
  // Fallback: extract the name segment from VLNV (vendor.library.name.major.minor)
  const parts = busType.split('.');
  const name = parts.length >= 3 ? parts[2] : (parts[parts.length - 1] ?? busType);
  const clean = name.replace(/_/g, '-');
  return clean.length <= 4 ? clean.toUpperCase() : clean.charAt(0).toUpperCase() + clean.slice(1);
}

/**
 * Returns true if this bus type + mode combination supports a memory map reference.
 * Only single (non-array), slave-mode, memory-mapped protocols qualify:
 * AXI4-Lite, AXI4-Full, Avalon-MM.
 */
export function supportsMemoryMap(busType: string, mode: string): boolean {
  if (mode !== 'slave') {
    return false;
  }
  const lower = busType.toLowerCase();
  // Streaming protocols are never memory-mapped
  if (
    lower.includes('stream') ||
    lower.includes('axi4s') ||
    lower.includes('avalon_st') ||
    lower.includes('avalon-st')
  ) {
    return false;
  }
  return lower.includes('axi4') || lower.includes('avalon_mm') || lower.includes('avalon-mm');
}

function modeLabel(mode: string): string {
  switch (mode) {
    case 'slave':
    case 'sink':
      return 'S';
    case 'master':
    case 'source':
      return 'M';
    case 'conduit':
      return '';
    default:
      return mode;
  }
}

/** Returns true if this interface belongs on the left side (slave/sink/conduit) */
function isLeftSide(bus: BusInterface): boolean {
  return bus.mode === 'slave' || bus.mode === 'sink' || bus.mode === 'conduit';
}

function isInputDirection(dir: string | undefined): boolean {
  return dir === 'in' || dir === 'input' || dir === undefined;
}

/** How many layout slots an item occupies (1 normally, 1 + visible ports if expanded bus) */
function itemSlots(
  item: { kind: PortKind; index: number; data: unknown },
  expandedBusIds: Set<string>,
  busPortLookup: (busType: string) => BusPortDef[] | null
): number {
  if (item.kind !== 'bus') {
    return 1;
  }
  const busId = `bus:${item.index}`;
  if (!expandedBusIds.has(busId)) {
    return 1;
  }
  const busData = item.data as {
    type?: string;
    associatedClock?: string | null;
    associatedReset?: string | null;
    conduitPorts?: Array<{ name: string }>;
  };

  // Conduit: slot count comes from conduitPorts array
  const isConduitMode =
    (busData.type ?? '').toLowerCase().includes('conduit') || Array.isArray(busData.conduitPorts);
  if (isConduitMode) {
    return 1 + (busData.conduitPorts?.length ?? 0);
  }

  const allPorts = busPortLookup(busData.type ?? '');
  if (!allPorts) {
    return 1;
  }
  const hasClock = !!busData.associatedClock;
  const hasReset = !!busData.associatedReset;
  const visibleCount = allPorts.filter((p) => {
    if (p.role === 'clock' && hasClock) {
      return false;
    }
    if (p.role === 'reset' && hasReset) {
      return false;
    }
    return true;
  }).length;
  return 1 + visibleCount;
}

// --- Main layout function ---

/**
 * Compute spatial positions for every port/bus around the IP core block.
 *
 * Placement rules:
 *  Left edge (top to bottom): clocks, resets, slave buses, input ports
 *  Right edge (top to bottom): master buses, output ports
 *  Bottom edge: bidirectional ports
 */
export function computeLayout(
  ipCore: IpCore,
  expandedBusIds: Set<string> = new Set(),
  busPortLookup: (busType: string) => BusPortDef[] | null = () => null,
  description?: string
): CanvasLayout {
  const clocks = ipCore.clocks ?? [];
  const resets = ipCore.resets ?? [];
  const ports = ipCore.ports ?? [];
  const buses = ipCore.busInterfaces ?? [];
  const rawParameters = (ipCore.parameters ?? []) as unknown as Array<Record<string, unknown>>;

  // Build the inline parameter list (shown inside the block, not as stubs)
  const layoutParameters: LayoutParameter[] = rawParameters.map((p, i) => {
    const defVal = p.defaultValue !== undefined ? p.defaultValue : p.value;
    const value =
      defVal !== undefined && defVal !== null && defVal !== '' ? String(defVal).slice(0, 10) : '';
    return { index: i, name: String(p.name ?? ''), value };
  });

  // Build the subcores section (Dependencies) shown inside the block above parameters
  const DEP_SEPARATOR_Y_OFFSET = 60; // separator from blockY (below VLNV header)
  const DEP_HEADER_HEIGHT = 26; // height occupied by separator line + "Dependencies" label
  const DEP_ROW_HEIGHT = 18;
  const DEP_AFTER_GAP = 8; // gap between last dep row and the parameter separator

  const rawSubcores = (ipCore.subcores ?? []) as Array<string | { vlnv: string; path?: string }>;
  const subcoreDeps: LayoutSubcoreDep[] = rawSubcores.map((s, i) => {
    const vlnv = typeof s === 'string' ? s : s.vlnv;
    const namePart = vlnv.split(':')[2] ?? vlnv;
    const rowCenterY =
      DEP_SEPARATOR_Y_OFFSET + DEP_HEADER_HEIGHT + i * DEP_ROW_HEIGHT + DEP_ROW_HEIGHT / 2;
    return { index: i, vlnv, shortName: namePart, y: rowCenterY };
  });

  const S = subcoreDeps.length;
  const depSectionHeight = S > 0 ? DEP_HEADER_HEIGHT + S * DEP_ROW_HEIGHT + DEP_AFTER_GAP : 0;

  // Vertical layout constants for the generics section inside the block
  const PARAM_SEPARATOR_Y_OFFSET = DEP_SEPARATOR_Y_OFFSET + depSectionHeight;
  const PARAM_FIRST_ROW_OFFSET = PARAM_SEPARATOR_Y_OFFSET + 26; // separator + 26px header
  const PARAM_ROW_HEIGHT = 18;
  const AFTER_PARAMS_GAP = 12; // gap from last param row to port separator

  const N = layoutParameters.length;

  // When subcores or params exist, ports are pushed below those sections.
  // portSeparatorOffset: distance from blockY to the second separator line.
  const portSeparatorOffset =
    N > 0
      ? PARAM_FIRST_ROW_OFFSET + N * PARAM_ROW_HEIGHT + AFTER_PARAMS_GAP
      : S > 0
        ? PARAM_SEPARATOR_Y_OFFSET
        : null;

  // portsAreaTopRelative: distance from blockY to where port stubs begin.
  const portsAreaTopRelative =
    portSeparatorOffset !== null ? portSeparatorOffset + EDGE_PADDING : null;

  // Build a clock-name → index map for domain colour resolution
  const clockNameToIdx = new Map<string, number>();
  clocks.forEach((c, i) => clockNameToIdx.set(c.name, i));

  /** Clock domain index for a bus interface (via its associatedClock), or -1 */
  const busDomainIdx = (busData: { associatedClock?: string | null }): number =>
    clockNameToIdx.get(busData.associatedClock ?? '') ?? -1;

  /** Clock domain index for a reset — derived from any bus interface that references it */
  const resetDomainIdx = (resetName: string): number => {
    for (const b of buses) {
      if (b.associatedReset === resetName && b.associatedClock) {
        const idx = clockNameToIdx.get(b.associatedClock);
        if (idx !== undefined) {
          return idx;
        }
      }
    }
    return -1;
  };

  // Classify ports by side
  const leftItems: Array<{ kind: PortKind; index: number; data: unknown }> = [];
  const rightItems: Array<{ kind: PortKind; index: number; data: unknown }> = [];
  const bottomItems: Array<{ kind: PortKind; index: number; data: unknown }> = [];

  // Clocks -> left
  clocks.forEach((c, i) => leftItems.push({ kind: 'clock', index: i, data: c }));

  // Resets -> left
  resets.forEach((r, i) => leftItems.push({ kind: 'reset', index: i, data: r }));

  // Bus interfaces -> left (slave/sink/conduit) or right (master/source)
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

  // Interrupts -> right (out/default) or left (in)
  const interrupts = (ipCore.interrupts ?? []) as Interrupt[];
  interrupts.forEach((irq, i) => {
    if (irq.direction === 'in') {
      leftItems.push({ kind: 'interrupt', index: i, data: irq });
    } else {
      rightItems.push({ kind: 'interrupt', index: i, data: irq });
    }
  });

  // Total slots per side (accounts for expanded buses)
  const leftSlots = leftItems.reduce(
    (acc, item) => acc + itemSlots(item, expandedBusIds, busPortLookup),
    0
  );
  const rightSlots = rightItems.reduce(
    (acc, item) => acc + itemSlots(item, expandedBusIds, busPortLookup),
    0
  );
  const maxSideSlots = Math.max(leftSlots, rightSlots, 1);

  // Block height must fit the params section AND the ports that follow it.
  // When there are no params/subcores the port area starts at BLOCK_HEADER_HEIGHT, so we
  // size the block from that offset: first port at BLOCK_HEADER_HEIGHT, last port at
  // BLOCK_HEADER_HEIGHT + (N-1)*PORT_PITCH, block bottom EDGE_PADDING below last-port edge.
  const portsBlockHeight = Math.max(
    MIN_BLOCK_HEIGHT,
    portsAreaTopRelative !== null
      ? portsAreaTopRelative + maxSideSlots * PORT_PITCH + EDGE_PADDING
      : BLOCK_HEADER_HEIGHT + maxSideSlots * PORT_PITCH - PORT_PITCH / 2 + EDGE_PADDING
  );

  // Description section appended below the ports
  const descLines = description ? wrapText(description, DESC_CHARS_PER_LINE) : [];
  const descSectionHeight =
    descLines.length > 0
      ? DESC_PADDING_TOP + descLines.length * DESC_LINE_HEIGHT + DESC_PADDING_BOTTOM
      : 0;
  const blockHeight = portsBlockHeight + descSectionHeight;

  // Block width may expand for bottom ports
  const bottomWidth = bottomItems.length * PORT_PITCH + EDGE_PADDING * 2;
  const blockWidth = Math.max(BLOCK_WIDTH, bottomWidth);

  // Block position (centered horizontally in the canvas)
  const blockX = CANVAS_MARGIN_X;
  const blockY = CANVAS_MARGIN_Y;

  // Position side ports
  const layoutPorts: LayoutPort[] = [];
  const layoutSubPorts: LayoutSubPort[] = [];

  const positionSide = (items: typeof leftItems, side: PortSide, baseX: number) => {
    let currentY: number;
    if (portsAreaTopRelative !== null) {
      // Force ports to start below the generics section
      currentY = blockY + portsAreaTopRelative + PORT_PITCH / 2;
    } else {
      // No params — start ports at BLOCK_HEADER_HEIGHT so the first port label never
      // overlaps the VLNV subtitle rendered at blockY+42.  The centeredY formula is kept
      // as a fallback: when MIN_BLOCK_HEIGHT makes the block taller than needed it centres
      // the ports, but the clamp ensures we never go above BLOCK_HEADER_HEIGHT.
      const totalHeight = maxSideSlots * PORT_PITCH;
      const centeredY = blockY + (portsBlockHeight - totalHeight) / 2 + PORT_PITCH / 2;
      currentY = Math.max(centeredY, blockY + BLOCK_HEADER_HEIGHT);
    }

    items.forEach((item) => {
      const y = currentY;
      const id = `${item.kind}:${item.index}`;

      let label = '';
      let widthLabel = '';
      let protocol: string | undefined;
      let mode: string | undefined;
      let arrayCount: number | undefined;
      let memoryMapRef: string | undefined;
      let direction: 'in' | 'out' | 'inout' | undefined;
      let domainIdx = -1;

      const d = item.data as Record<string, unknown>;
      switch (item.kind) {
        case 'clock':
          label = String(d.name ?? '');
          widthLabel = '';
          domainIdx = item.index;
          direction = (d.direction as 'in' | 'out' | 'inout' | undefined) ?? 'in';
          break;
        case 'reset':
          label = String(d.name ?? '');
          widthLabel = '';
          domainIdx = resetDomainIdx(String(d.name ?? ''));
          direction = (d.direction as 'in' | 'out' | 'inout' | undefined) ?? 'in';
          break;
        case 'port':
          label = String(d.name ?? '');
          widthLabel = formatWidth(d.width as number | string | undefined);
          direction = d.direction as 'in' | 'out' | 'inout' | undefined;
          break;
        case 'interrupt':
          label = String(d.name ?? '');
          widthLabel = formatWidth(d.width as number | string | undefined);
          direction = (d.direction as 'in' | 'out' | 'inout' | undefined) ?? 'out';
          break;
        case 'bus': {
          protocol = busProtocolShortName(String(d.type ?? ''));
          mode = modeLabel(String(d.mode ?? ''));
          widthLabel = '';
          domainIdx = busDomainIdx(d as { associatedClock?: string | null });
          const arrCfg = d.array as { count?: number; namingPattern?: string } | undefined | null;
          if (arrCfg?.count && arrCfg.count > 1) {
            arrayCount = arrCfg.count;
            // Show the naming pattern so it's clear this is a replicated interface
            label = arrCfg.namingPattern ?? String(d.name ?? '');
          } else {
            label = String(d.name ?? '');
            // Only single interfaces can carry a memoryMapRef badge
            const mmRef = d.memoryMapRef as string | undefined | null;
            if (mmRef) {
              memoryMapRef = mmRef;
            }
          }
          break;
        }
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
        arrayCount,
        memoryMapRef,
        direction,
        data: item.data,
        clockDomainIdx: domainIdx,
      });

      // If this bus is expanded, emit sub-ports below it
      if (item.kind === 'bus' && expandedBusIds.has(id)) {
        const busData = item.data as {
          type?: string;
          mode?: string;
          useOptionalPorts?: string[];
          portWidthOverrides?: Record<string, number | string>;
          portNameOverrides?: Record<string, string>;
          physicalPrefix?: string;
          associatedClock?: string | null;
          associatedReset?: string | null;
          array?: { count?: number; physicalPrefixPattern?: string } | null;
          conduitPorts?: Array<{
            name: string;
            direction: 'in' | 'out' | 'inout';
            width?: number | string;
            presence?: 'required' | 'optional';
          }>;
        };

        const isConduit =
          (busData.type ?? '').toLowerCase().includes('conduit') ||
          Array.isArray(busData.conduitPorts);

        if (isConduit) {
          // Conduit: user-defined signals come from conduitPorts
          const conduitPorts = busData.conduitPorts ?? [];
          conduitPorts.forEach((cp, pi) => {
            const subY = y + PORT_PITCH * (pi + 1);
            layoutSubPorts.push({
              // Use index-based ID (`cp:N`) so duplicate port names never produce
              // duplicate React keys, which would leave stale elements mounted after collapse.
              id: `bus:${item.index}:cp:${pi}`,
              parentBusId: id,
              x: baseX,
              y: subY,
              side,
              name: cp.name,
              widthLabel: formatWidth(cp.width),
              direction: cp.direction,
              presence: cp.presence ?? 'required',
              active: true,
              physicalPrefix: busData.physicalPrefix ?? '',
              physicalSuffix: cp.name,
              clockDomainIdx: domainIdx,
            });
          });
          currentY += PORT_PITCH * (1 + conduitPorts.length);
        } else {
          const allPortDefs = busPortLookup(busData.type ?? '') ?? [];
          const useOptional = busData.useOptionalPorts ?? [];
          const overrides = busData.portWidthOverrides ?? {};
          const nameOverrides = busData.portNameOverrides ?? {};
          const hasClock = !!busData.associatedClock;
          const hasReset = !!busData.associatedReset;
          // Directions in bus definitions are from the master perspective; flip for slave/sink.
          const isMaster = busData.mode === 'master' || busData.mode === 'source';
          const flipDir = (d: 'in' | 'out' | undefined): 'in' | 'out' | undefined =>
            d === 'in' ? 'out' : d === 'out' ? 'in' : undefined;

          // Filter out clock/reset signals that are covered by explicit associations
          const visibleDefs = allPortDefs.filter((portDef) => {
            if (portDef.role === 'clock' && hasClock) {
              return false;
            }
            if (portDef.role === 'reset' && hasReset) {
              return false;
            }
            return true;
          });

          visibleDefs.forEach((portDef, pi) => {
            const subY = y + PORT_PITCH * (pi + 1);
            const rawWidth = overrides[portDef.name] ?? portDef.width;
            const widthLbl = formatWidth(rawWidth as number | string | undefined);
            const active = portDef.presence === 'required' || useOptional.includes(portDef.name);

            // For array interfaces, use the physicalPrefixPattern so the sub-port
            // physical name reflects the replicated naming (e.g. m_axis_ch{index}_tdata)
            const subPhysicalPrefix =
              (busData.array?.count ?? 0) > 1 && busData.array?.physicalPrefixPattern
                ? busData.array.physicalPrefixPattern
                : (busData.physicalPrefix ?? '');

            const physicalSuffix = nameOverrides[portDef.name];
            const subPortDir = isMaster ? portDef.direction : flipDir(portDef.direction);
            layoutSubPorts.push({
              id: `bus:${item.index}:${portDef.name}`,
              parentBusId: id,
              x: baseX,
              y: subY,
              side,
              name: portDef.name,
              widthLabel: widthLbl,
              direction: subPortDir,
              presence: portDef.presence,
              active,
              physicalPrefix: subPhysicalPrefix,
              ...(physicalSuffix !== undefined ? { physicalSuffix } : {}),
              clockDomainIdx: domainIdx,
            });
          });

          currentY += PORT_PITCH * (1 + visibleDefs.length);
        }
      } else {
        currentY += PORT_PITCH;
      }
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
      const p = item.data as Record<string, unknown>;

      layoutPorts.push({
        id,
        x,
        y: baseY,
        side: 'bottom',
        kind: item.kind,
        label: String(p.name ?? ''),
        widthLabel: formatWidth(p.width as number | string | undefined),
        data: item.data,
        clockDomainIdx: -1,
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
    subPorts: layoutSubPorts,
    viewBox: { width: viewWidth, height: viewHeight },
    coreName,
    vlnvLabel,
    parameters: layoutParameters,
    paramSeparatorY: blockY + PARAM_SEPARATOR_Y_OFFSET,
    portSeparatorY:
      portSeparatorOffset !== null
        ? blockY + portSeparatorOffset
        : blockY + PARAM_SEPARATOR_Y_OFFSET,
    descLines,
    descSeparatorY: blockY + portsBlockHeight,
    subcoreDeps: subcoreDeps.map((d) => ({ ...d, y: blockY + d.y })),
    depSeparatorY: blockY + DEP_SEPARATOR_Y_OFFSET,
  };
}
