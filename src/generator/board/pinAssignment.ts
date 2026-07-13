import type { IpCoreData } from '../types';
import type { BoardDefinition, BoardIo } from './types';

/**
 * Convert a board net name (e.g. "FPGA_CLK1_50") into the lowercase identifier used as a
 * port name on the generated board-top wrapper (e.g. "fpga_clk1_50").
 */
export function netPortName(net: string): string {
  return net.toLowerCase();
}

export interface PinAssignment {
  /** Top-level RTL port name (or board-top wrapper port name). */
  port: string;
  /** Board net name, e.g. "LED0". */
  net: string;
  /** Physical device pin, e.g. "PIN_W15". */
  pin: string;
  ioStandard?: string;
}

export interface PortMapResult {
  /**
   * IP port name -> board net name(s). Single-bit ports (clock, reset, width-1 user
   * ports) map to one net. A width-N user port maps to an ordered array of N nets
   * (index i = bit i), since each board io is a single physical pin.
   */
  map: Record<string, string | string[]>;
  errors: string[];
}

export interface PinAssignmentResult {
  assignments: PinAssignment[];
  errors: string[];
}

/**
 * Auto-map an IP core's primary clock/reset and top-level user ports onto a board's
 * clock/reset/io nets: primary clock -> board's primary clock, primary reset (if the IP
 * declares one) -> board's primary reset, then each user port in declaration order onto
 * the next unused board io of matching direction (LEDs/switches/buttons).
 *
 * A reset with no board net to map onto is left unmapped rather than treated as an error —
 * unlike a missing clock (which has no fallback), BoardProjectScaffolder synthesizes a
 * power-on reset for an unmapped reset instead of failing.
 */
export function resolveBoardPortMap(ipCoreData: IpCoreData, board: BoardDefinition): PortMapResult {
  const map: Record<string, string | string[]> = {};
  const errors: string[] = [];

  const primaryClock = ipCoreData.clocks?.[0];
  if (primaryClock?.name) {
    const boardClock = board.clocks[0];
    if (!boardClock) {
      errors.push(`No board clock available to map IP clock '${primaryClock.name}'.`);
    } else {
      map[primaryClock.name] = boardClock.name;
    }
  }

  const primaryReset = ipCoreData.resets?.[0];
  if (primaryReset?.name) {
    const boardReset = board.resets[0];
    if (boardReset) {
      map[primaryReset.name] = boardReset.name;
    }
  }

  const usedIos = new Set<string>();
  for (const ipPort of ipCoreData.ports ?? []) {
    const name = ipPort.name;
    if (!name) {
      continue;
    }
    const direction = ipPort.direction === 'in' ? 'in' : 'out';
    const width = Number(ipPort.width) > 0 ? Number(ipPort.width) : 1;

    const candidates: BoardIo[] = [];
    for (const io of board.ios) {
      if (candidates.length >= width) {
        break;
      }
      if (io.direction === direction && !usedIos.has(io.name)) {
        candidates.push(io);
      }
    }
    if (candidates.length < width) {
      const totalMatching = board.ios.filter((io) => io.direction === direction).length;
      const reason =
        totalMatching === 0
          ? `the board has no '${direction}' io nets at all`
          : totalMatching < width
            ? `the board only has ${totalMatching} '${direction}' io net(s), fewer than the ${width} this port needs`
            : 'every matching board io is already mapped';
      errors.push(`No board '${direction}' io net available for port '${name}' — ${reason}.`);
      continue;
    }
    candidates.forEach((io) => usedIos.add(io.name));
    map[name] = width === 1 ? candidates[0].name : candidates.map((io) => io.name);
  }

  return { map, errors };
}

function findBoardNet(
  board: BoardDefinition,
  net: string
): { pin: string; ioStandard?: string } | undefined {
  const clock = board.clocks.find((c) => c.name === net);
  if (clock) {
    return { pin: clock.pin, ioStandard: clock.ioStandard };
  }
  const reset = board.resets.find((r) => r.name === net);
  if (reset) {
    return { pin: reset.pin, ioStandard: reset.ioStandard };
  }
  const io = board.ios.find((i) => i.name === net);
  if (io) {
    return { pin: io.pin, ioStandard: io.ioStandard };
  }
  return undefined;
}

/**
 * Resolve a port -> board-net map into concrete pin assignments, validating that every
 * mapped port actually exists on the top-level design and that every net actually exists
 * on the board.
 */
export function buildPinAssignments(
  board: BoardDefinition,
  map: Record<string, string | string[]>,
  topLevelPorts: string[]
): PinAssignmentResult {
  const assignments: PinAssignment[] = [];
  const errors: string[] = [];
  const topLevelSet = new Set(topLevelPorts);

  for (const [port, nets] of Object.entries(map)) {
    if (!topLevelSet.has(port)) {
      const netLabel = Array.isArray(nets) ? nets.join(', ') : nets;
      errors.push(
        `Mapped port '${port}' (board net '${netLabel}') was not found on the top-level design.`
      );
      continue;
    }
    // A width-N port maps to N nets, one physical pin per bit — index the port
    // (e.g. led[0]) so each bit gets its own set_location_assignment.
    const netList = Array.isArray(nets) ? nets : [nets];
    const indexed = netList.length > 1;
    netList.forEach((net, i) => {
      const boardNet = findBoardNet(board, net);
      if (!boardNet) {
        errors.push(
          `Board net '${net}' (mapped to port '${port}') does not exist on board '${board.name}'.`
        );
        return;
      }
      assignments.push({
        port: indexed ? `${port}[${i}]` : port,
        net,
        pin: boardNet.pin,
        ioStandard: boardNet.ioStandard,
      });
    });
  }

  return { assignments, errors };
}
