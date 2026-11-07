/** Clock and reset facts of one selected block, as table rows. */

import type { SystemGraph, SystemInstance } from '../../../domain/systemGraph';
import { endpointKey, netsByEndpoint } from '../model';
import type { ClockAnalysis } from './analyzeClocks';
import type {
  ClockDomain,
  ClockKnownFrom,
  ExpectedFrequency,
  PinCrossing,
  ResetSource,
} from './clockTypes';
import { DATA_CATEGORIES } from './crossings';
import { resetCheck, type RowCheck } from './treeChecks';

/** A clock input and the domain its net is on. */
export interface ClockPinRow {
  pin: string;
  /** Net of the pin on the block's level. */
  netId?: string;
  domain?: ClockDomain;
  expected?: ExpectedFrequency;
}

/** A data interface and the clock it belongs to. */
export interface InterfaceClockRow {
  pin: string;
  /** Clock pin of the block, when the definition or the only clock names it. */
  clockPin?: string;
  /** The domain, when known (the clock pin may be unknown while all clocks share one domain). */
  domain?: ClockDomain;
  /** Absent when the clock cannot be known offline. */
  knownFrom?: ClockKnownFrom;
}

/** A reset input, the source that releases it and the check of that release. */
export interface ResetPinRow {
  pin: string;
  netId: string;
  source: ResetSource;
  check?: RowCheck;
}

export interface InstanceClocks {
  clockPins: ClockPinRow[];
  /** Empty for a hierarchy block. */
  interfaces: InterfaceClockRow[];
  resets: ResetPinRow[];
  /** An interface or reset has a clock that is not known; the definition would tell. */
  hasUnchecked: boolean;
}

function isSourceOf(reset: ResetSource, instance: SystemInstance, pin: string): boolean {
  return reset.source?.instance === instance.path && reset.source.pin === pin;
}

function resetCrossingOf(
  analysis: ClockAnalysis,
  instance: SystemInstance,
  pin: string
): PinCrossing | undefined {
  return analysis.crossings.find(
    (crossing): crossing is PinCrossing =>
      crossing.kind === 'reset' && crossing.to.instance === instance.path && crossing.to.pin === pin
  );
}

export function instanceClocks(
  graph: SystemGraph,
  analysis: ClockAnalysis,
  instance: SystemInstance
): InstanceClocks {
  const level = instance.parent;
  const nets = netsByEndpoint(graph, level);
  const netsOf = (pin: string) => nets.get(endpointKey({ instance: instance.path, pin })) ?? [];
  const clockPins: ClockPinRow[] = analysis.clockInputs(instance.path).map((pin) => {
    const ref = { instance: instance.path, pin: pin.name };
    const domain = analysis.domainOfPin(level, ref);
    const expected = analysis.expectedFrequency(level, ref);
    const net = netsOf(pin.name)[0];
    return {
      pin: pin.name,
      ...(net && { netId: net.id }),
      ...(domain && { domain }),
      ...(expected && { expected }),
    };
  });
  const interfaces: InterfaceClockRow[] = [];
  const resets: ResetPinRow[] = [];
  if (instance.kind !== 'hier') {
    for (const pin of instance.pins) {
      const ref = { instance: instance.path, pin: pin.name };
      const pinNets = netsOf(pin.name);
      if (pin.isInterface && pinNets.some((net) => DATA_CATEGORIES.includes(net.category))) {
        const clock = analysis.clockOfPin(level, ref);
        interfaces.push({
          pin: pin.name,
          ...(clock?.clockPin !== undefined && { clockPin: clock.clockPin }),
          ...(clock?.domain && { domain: clock.domain }),
          ...(clock && { knownFrom: clock.knownFrom }),
        });
      }
      const source = analysis.resetOfPin(level, ref);
      if (source && pinNets[0] && !isSourceOf(source, instance, pin.name)) {
        const crossing = resetCrossingOf(analysis, instance, pin.name);
        resets.push({
          pin: pin.name,
          netId: pinNets[0].id,
          source,
          ...(crossing && { check: resetCheck(crossing) }),
        });
      }
    }
  }
  return {
    clockPins,
    interfaces,
    resets,
    hasUnchecked:
      interfaces.some((row) => row.knownFrom === undefined) ||
      resets.some((row) => row.source.source !== undefined && row.check?.tone === 'muted'),
  };
}
