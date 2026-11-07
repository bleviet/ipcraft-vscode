/**
 * Related clocks: the outputs of one clock generator (`clk_wiz`, `clk_wizard`),
 * and the clock that feeds its input. Vivado times the paths between them, so a
 * connection between related clocks is not an unchecked crossing. Only the
 * generators in `CLOCK_GENERATORS` count; a PS clock is never related to another.
 */

import type { SystemGraph, SystemInstance } from '../../../domain/systemGraph';
import { generatorOf, isClockOutput } from './clockRules';
import type { ClockDomains } from './clockDomains';
import type { ClockDomain } from './clockTypes';

/** The generator that makes two different domains related; undefined when they are not. */
export type RelatedClocks = (a: ClockDomain, b: ClockDomain) => SystemInstance | undefined;

interface Generator {
  instance: SystemInstance;
  outputs: Set<ClockDomain>;
  inputs: Set<ClockDomain>;
}

export function buildRelatedClocks(graph: SystemGraph, model: ClockDomains): RelatedClocks {
  const generators: Generator[] = [];
  for (const instance of Object.values(graph.instances)) {
    const rule = instance.kind === 'hier' ? undefined : generatorOf(instance);
    if (!rule) {
      continue;
    }
    const generator: Generator = { instance, outputs: new Set(), inputs: new Set() };
    for (const pin of instance.pins) {
      const domain = model.domainOfPin(instance.parent, { instance: instance.path, pin: pin.name });
      if (domain && isClockOutput(instance, pin.name)) {
        generator.outputs.add(domain);
      } else if (domain && rule.input.test(pin.name)) {
        generator.inputs.add(domain);
      }
    }
    generators.push(generator);
  }
  return (a, b) =>
    a === b
      ? undefined
      : generators.find(
          ({ outputs, inputs }) =>
            (outputs.has(a) && (outputs.has(b) || inputs.has(b))) ||
            (outputs.has(b) && inputs.has(a))
        )?.instance;
}
