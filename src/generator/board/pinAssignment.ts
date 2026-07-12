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
  /** IP port name -> board net name. */
  map: Record<string, string>;
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
 */
export function resolveBoardPortMap(ipCoreData: IpCoreData, board: BoardDefinition): PortMapResult {
  const map: Record<string, string> = {};
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
    if (!boardReset) {
      errors.push(`No board reset available to map IP reset '${primaryReset.name}'.`);
    } else {
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
    const candidate = board.ios.find(
      (io: BoardIo) => io.direction === direction && !usedIos.has(io.name)
    );
    if (!candidate) {
      errors.push(
        `No board '${direction}' io net available for port '${name}' — every matching board io is already mapped.`
      );
      continue;
    }
    usedIos.add(candidate.name);
    map[name] = candidate.name;
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
  map: Record<string, string>,
  topLevelPorts: string[]
): PinAssignmentResult {
  const assignments: PinAssignment[] = [];
  const errors: string[] = [];
  const topLevelSet = new Set(topLevelPorts);

  for (const [port, net] of Object.entries(map)) {
    if (!topLevelSet.has(port)) {
      errors.push(
        `Mapped port '${port}' (board net '${net}') was not found on the top-level design.`
      );
      continue;
    }
    const boardNet = findBoardNet(board, net);
    if (!boardNet) {
      errors.push(
        `Board net '${net}' (mapped to port '${port}') does not exist on board '${board.name}'.`
      );
      continue;
    }
    assignments.push({ port, net, pin: boardNet.pin, ioStandard: boardNet.ioStandard });
  }

  return { assignments, errors };
}
