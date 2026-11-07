/**
 * The clock of an interface or reset pin. No name matching: a leaf block says it
 * in its definition (`associatedClock`), has one clock, or has all its clocks on
 * one domain; an external port is tied to its clock port by script parameters.
 * Anything else is unknown and is reported as "not checked".
 */

import type { PinRef, SystemGraph, SystemPin } from '../../../domain/systemGraph';
import { resolvePin } from '../model';
import type { ClockDomains } from './clockDomains';
import type { ClockDomain, ExpectedFrequency, PinClock } from './clockTypes';
import { parseFrequency } from './frequency';
import { PORT_INTERFACES_PARAMETER, PORT_RESETS_PARAMETER } from './clockRules';

export interface PinClocks {
  /** Undefined when the pin has no way to know its clock (see {@link PinClocks.unknownReason}). */
  clockOfPin: (level: string, ref: PinRef) => PinClock | undefined;
  /** Why the clock of a crossing end (an instance pin or a root port) is not known, as one sentence naming the block and the pin. */
  unknownReason: (level: string, ref: PinRef) => string;
  expectedFrequency: (level: string, ref: PinRef) => ExpectedFrequency | undefined;
}

type PortParameter = typeof PORT_INTERFACES_PARAMETER | typeof PORT_RESETS_PARAMETER;

interface ClockPort {
  port: SystemPin;
  /** The parameter of `port` that lists the pin. */
  parameter: PortParameter;
}

function findPin(pins: readonly SystemPin[], name: string): SystemPin | undefined {
  return (
    pins.find((pin) => pin.name === name) ??
    pins.find((pin) => pin.name.toLowerCase() === name.toLowerCase())
  );
}

/** Colon-separated names of a port parameter, e.g. `CONFIG.ASSOCIATED_BUSIF {S_AXIS:M_AXIS}`. */
function listed(pin: SystemPin, parameter: string): string[] {
  return (pin.parameters[parameter] ?? '').split(':').map((name) => name.trim());
}

export function buildPinClocks(graph: SystemGraph, model: ClockDomains): PinClocks {
  const rootPins = graph.levels['/']?.boundaryPins ?? [];

  /** The root clock port whose script parameter lists `pin`. */
  const clockPortOf = (pin: SystemPin): ClockPort | undefined => {
    const parameter = pin.isInterface ? PORT_INTERFACES_PARAMETER : PORT_RESETS_PARAMETER;
    const port = rootPins.find((candidate) => listed(candidate, parameter).includes(pin.name));
    return port && { port, parameter };
  };

  const clockOfPin = (level: string, ref: PinRef): PinClock | undefined => {
    const pin = resolvePin(graph, level, ref);
    if (!pin) {
      return undefined;
    }
    if (ref.instance === null) {
      const found = level === '/' ? clockPortOf(pin) : undefined;
      return (
        found && {
          clockPin: found.port.name,
          domain: model.domainOfPin('/', { instance: null, pin: found.port.name }),
          knownFrom: found.parameter,
        }
      );
    }
    const instance = graph.instances[ref.instance];
    if (!instance || instance.kind === 'hier') {
      return undefined;
    }
    const domainOf = (clockPin: string) =>
      model.domainOfPin(instance.parent, { instance: instance.path, pin: clockPin });
    if (pin.associatedClock) {
      const clock = findPin(instance.pins, pin.associatedClock);
      return {
        clockPin: clock?.name ?? pin.associatedClock,
        domain: clock && domainOf(clock.name),
        knownFrom: pin.definedBy === 'ip.yml' ? 'ip.yml' : 'definition',
      };
    }
    const inputs = model.clockInputs(instance.path);
    if (inputs.length === 1) {
      return {
        clockPin: inputs[0].name,
        domain: domainOf(inputs[0].name),
        knownFrom: 'single clock',
      };
    }
    const domains = model.instanceDomains(instance.path);
    return domains.length === 1
      ? { domain: domains[0], knownFrom: 'all clocks one domain' }
      : undefined;
  };

  const unknownReason = (level: string, ref: PinRef): string => {
    const pin = resolvePin(graph, level, ref);
    if (ref.instance === null) {
      const parameter = pin?.isInterface ? PORT_INTERFACES_PARAMETER : PORT_RESETS_PARAMETER;
      const found = pin && clockPortOf(pin);
      return found
        ? `clock port ${found.port.name} is not connected`
        : `external port ${ref.pin} is not listed in ${parameter} of a clock port`;
    }
    const instance = graph.instances[ref.instance];
    const name = instance?.name ?? ref.instance;
    const clockPin = clockOfPin(level, ref)?.clockPin;
    if (clockPin !== undefined) {
      return `clock pin ${clockPin} of ${name} is not connected`;
    }
    const count = instance ? model.instanceDomains(instance.path).length : 0;
    return count >= 2
      ? `${name} has clocks on ${count} domains; the clock of ${ref.pin} is in its definition`
      : `${name} has no clock with a known domain`;
  };

  const expectedFrequency = (level: string, ref: PinRef): ExpectedFrequency | undefined => {
    const expected = resolvePin(graph, level, ref)?.frequency;
    if (expected === undefined) {
      return undefined;
    }
    const domain: ClockDomain | undefined = model.domainOfPin(level, ref);
    const expectedHz = parseFrequency(expected);
    let status: ExpectedFrequency['status'] = 'unknown';
    if (expectedHz !== undefined && domain?.hz !== undefined) {
      status = Math.abs(expectedHz - domain.hz) <= expectedHz * 1e-9 ? 'match' : 'mismatch';
    }
    return {
      expected,
      ...(expectedHz !== undefined && { expectedHz }),
      ...(domain && { domain }),
      status,
    };
  };

  return { clockOfPin, unknownReason, expectedFrequency };
}
