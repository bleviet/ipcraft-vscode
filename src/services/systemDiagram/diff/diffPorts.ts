import type { SystemGraph } from '../../../domain/systemGraph';
import type { PortChange } from '../../../domain/systemGraphDiff';
import { compareText } from './compareText';
import { classifyPin, type PinContext } from './diffPins';
import { diffPinAttributes } from './pinAttributes';
import { ROOT } from './pinPeers';

/** Changes of the external ports (boundary pins of the root level), sorted by name. */
export function diffPorts(base: SystemGraph, current: SystemGraph, ctx: PinContext): PortChange[] {
  const basePins = new Map(base.levels[ROOT].boundaryPins.map((p) => [p.name, p]));
  const currentPins = new Map(current.levels[ROOT].boundaryPins.map((p) => [p.name, p]));
  const changes: PortChange[] = [];
  for (const name of [...new Set([...basePins.keys(), ...currentPins.keys()])].sort(compareText)) {
    const [b, c] = [basePins.get(name), currentPins.get(name)];
    const attributes = diffPinAttributes(b, c);
    const change = classifyPin(
      ctx,
      { instance: null, level: ROOT, pin: name },
      { base: b !== undefined, current: c !== undefined },
      attributes.length > 0
    );
    if (change) {
      changes.push({ ...change, attributes });
    }
  }
  return changes;
}
