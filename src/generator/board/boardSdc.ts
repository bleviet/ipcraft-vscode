import type { BoardDefinition } from './types';
import { netPortName } from './pinAssignment';

export interface BoardClockConstraint {
  /** Wrapper port name (lowercased board net), e.g. "fpga_clk1_50". */
  name: string;
  period_ns: string;
}

/**
 * Board-mode timing constraint for the board's primary clock, keyed on the board net name
 * (as exposed by the board-top wrapper) rather than the IP's own clock port name.
 */
export function primaryBoardClockConstraint(
  board: BoardDefinition
): BoardClockConstraint | undefined {
  const clock = board.clocks[0];
  if (!clock) {
    return undefined;
  }
  return {
    name: netPortName(clock.name),
    period_ns: (1e9 / clock.frequencyHz).toFixed(3),
  };
}
