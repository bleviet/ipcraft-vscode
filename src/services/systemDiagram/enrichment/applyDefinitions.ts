/**
 * Merges instance definitions (pins from `.ip.yml` or HDL) into a system
 * graph. Pure: returns a new graph and never mutates its input.
 */

import type { SystemGraph, SystemInstance, SystemPin } from '../../../domain/systemGraph';
import type { DefinitionPin, InstanceDefinition } from './instanceDefinition';

function findPin(pins: readonly SystemPin[], name: string): SystemPin | undefined {
  return (
    pins.find((pin) => pin.name === name) ??
    pins.find((pin) => pin.name.toLowerCase() === name.toLowerCase())
  );
}

function fillMissing(pin: SystemPin, definition: DefinitionPin): void {
  pin.vlnv ??= definition.vlnv;
  pin.interfaceType ??= definition.interfaceType;
  pin.signalType ??= definition.signalType;
  pin.width ??= definition.width;
  pin.associatedClock ??= definition.associatedClock;
  pin.frequency ??= definition.frequency;
}

function applyToInstance(instance: SystemInstance, definition: InstanceDefinition): string[] {
  instance.definition = {
    kind: definition.kind,
    file: definition.file,
    uri: definition.uri,
    displayName: definition.displayName,
  };
  const original = [...instance.pins];
  const interfacePins = original.filter((pin) => pin.isInterface);
  const matched = new Set<SystemPin>();
  for (const defined of definition.pins) {
    const existing = findPin(original, defined.name);
    if (existing) {
      matched.add(existing);
      existing.definedBy = definition.kind;
      if (defined.direction !== 'unknown') {
        existing.direction = defined.direction;
        existing.directionSource = 'definition';
      }
      fillMissing(existing, defined);
      continue;
    }
    // Vivado infers interfaces from port prefixes: the port is part of that
    // interface, which is thereby defined by the HDL.
    const lower = defined.name.toLowerCase();
    const owner =
      definition.kind === 'hdl'
        ? interfacePins.find((pin) => lower.startsWith(`${pin.name.toLowerCase()}_`))
        : undefined;
    if (owner) {
      owner.definedBy = 'hdl';
      matched.add(owner);
      continue;
    }
    const pin: SystemPin = {
      name: defined.name,
      isInterface: defined.isInterface,
      direction: defined.direction,
      directionSource: 'definition',
      parameters: {},
      definedBy: definition.kind,
    };
    fillMissing(pin, defined);
    instance.pins.push(pin);
  }
  const instanceKey = instance.path.replace(/^\//, '');
  return original.filter((pin) => !matched.has(pin)).map((pin) => `${instanceKey}/${pin.name}`);
}

export function applyDefinitions(
  graph: SystemGraph,
  definitions: ReadonlyMap<string, InstanceDefinition>
): SystemGraph {
  const result = JSON.parse(JSON.stringify(graph)) as SystemGraph;
  // One diagnostic per level so its lines refer to a single file; root first.
  const outOfDate = new Map<string, { pins: string[]; lines: number[] }>([
    ['/', { pins: [], lines: [] }],
  ]);
  for (const [path, definition] of definitions) {
    const instance = result.instances[path];
    if (!instance) {
      continue;
    }
    const missing = applyToInstance(instance, definition);
    if (missing.length > 0) {
      const group = outOfDate.get(instance.parent) ?? { pins: [], lines: [] };
      group.pins.push(...missing);
      group.lines.push(instance.line);
      outOfDate.set(instance.parent, group);
    }
  }
  for (const [level, { pins, lines }] of outOfDate) {
    if (pins.length > 0) {
      result.diagnostics.push({
        severity: 'info',
        message: `Pins not in their definition (the definition may be out of date): ${pins.join(', ')}`,
        lines,
        ...(level !== '/' && { level }),
      });
    }
  }
  const typed = Object.values(result.instances).filter((instance) => instance.kind !== 'hier');
  const defined = typed.filter((instance) => instance.definition !== undefined).length;
  if (defined > 0) {
    result.capabilities.unconnectedPins = defined === typed.length ? 'complete' : 'partial';
  }
  return result;
}
