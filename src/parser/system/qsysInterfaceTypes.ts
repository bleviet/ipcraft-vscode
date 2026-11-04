/**
 * Platform Designer interface/connection types: the one table that maps a
 * type and the end of a connection (or the `dir` of an exported interface) to
 * the pin direction and net category. Every direction and category of a
 * `.qsys` is known from this, so no inference runs.
 */

import type { NetCategory, PinDirection, SignalType } from '../../domain/systemGraph';

export type QsysEnd = 'start' | 'end';

export interface QsysEndpointSpec {
  direction: PinDirection;
  isInterface: boolean;
  signalType?: SignalType;
  category: NetCategory;
}

/** `start` and `end` as `[direction, direction]` plus the type's shared traits. */
const SIGNAL_TYPES = new Map<string, [PinDirection, PinDirection, SignalType, NetCategory]>([
  ['clock', ['out', 'in', 'clk', 'clock']],
  ['reset', ['out', 'in', 'rst', 'reset']],
  // The interrupt receiver is the connection start, the sender its end.
  ['interrupt', ['in', 'out', 'intr', 'interrupt']],
]);

function interfaceCategory(type: string): NetCategory {
  if (type === 'avalon') {
    return 'avalonmm';
  }
  if (type === 'avalon_streaming') {
    return 'avalonst';
  }
  if (type.startsWith('axi')) {
    return type.includes('stream') ? 'axis' : 'aximm';
  }
  return 'interface';
}

export function qsysEndpointSpec(type: string, end: QsysEnd): QsysEndpointSpec {
  const signal = SIGNAL_TYPES.get(type);
  if (signal) {
    return {
      direction: end === 'start' ? signal[0] : signal[1],
      isInterface: false,
      signalType: signal[2],
      category: signal[3],
    };
  }
  return {
    direction: end === 'start' ? 'master' : 'slave',
    isInterface: true,
    category: interfaceCategory(type),
  };
}
