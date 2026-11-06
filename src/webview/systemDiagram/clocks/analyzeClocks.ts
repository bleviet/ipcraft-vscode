/**
 * Entry point of the clock and reset analysis (issue #243): clock domains with
 * their frequencies, reset sources, and the crossings between them, plus the
 * lookups every surface needs. Pure and computed once per graph; the result
 * holds plain data and lookup closures, never React or vscode state.
 */

import type { PinRef, SystemGraph, SystemPin } from '../../../domain/systemGraph';
import { buildClockDomains } from './clockDomains';
import type { ClockDomain, Crossing, ExpectedFrequency, PinClock, ResetSource } from './clockTypes';
import { buildCrossings } from './crossings';
import { buildPhysicalNets } from './physicalNets';
import { buildPinClocks } from './pinClocks';
import { buildResetSources } from './resetSources';

export interface ClockAnalysis {
  /** In creation order (the script order of their source nets). */
  readonly domains: readonly ClockDomain[];
  readonly resets: readonly ResetSource[];
  /** `cross` first, then `inside`, `unchecked`, `ok`; data before reset. */
  readonly crossings: readonly Crossing[];
  /** The clock domain a net belongs to (any net of its tree, on any level). */
  domainOfNet: (netId: string) => ClockDomain | undefined;
  /** The clock domain a pin occurrence sits on. */
  domainOfPin: (level: string, ref: PinRef) => ClockDomain | undefined;
  /** The reset source a net belongs to. */
  resetOfNet: (netId: string) => ResetSource | undefined;
  resetOfPin: (level: string, ref: PinRef) => ResetSource | undefined;
  /** The clock of an interface or reset pin; undefined when it cannot be known. */
  clockOfPin: (level: string, ref: PinRef) => PinClock | undefined;
  /** Why the clock of a pin is unknown, as one sentence. */
  unknownClockReason: (level: string, ref: PinRef) => string;
  /** A clock pin's expected frequency from its definition against its domain; undefined without one. */
  expectedFrequency: (level: string, ref: PinRef) => ExpectedFrequency | undefined;
  /** Clock input pins of an instance. */
  clockInputs: (instancePath: string) => SystemPin[];
  /** Distinct domains of an instance's clock inputs, in domain order. */
  instanceDomains: (instancePath: string) => ClockDomain[];
}

export function analyzeClocks(graph: SystemGraph): ClockAnalysis {
  const physical = buildPhysicalNets(graph);
  const model = buildClockDomains(graph, physical);
  const pinClocks = buildPinClocks(graph, model);
  const sources = buildResetSources(graph, physical, model, pinClocks);
  return {
    domains: model.domains,
    resets: sources.resets,
    crossings: buildCrossings(graph, physical, model, pinClocks, sources),
    domainOfNet: model.domainOfNet,
    domainOfPin: model.domainOfPin,
    resetOfNet: sources.resetOfNet,
    resetOfPin: sources.resetOfPin,
    clockOfPin: pinClocks.clockOfPin,
    unknownClockReason: pinClocks.unknownReason,
    expectedFrequency: pinClocks.expectedFrequency,
    clockInputs: model.clockInputs,
    instanceDomains: model.instanceDomains,
  };
}
