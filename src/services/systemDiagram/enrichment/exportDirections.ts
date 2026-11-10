/**
 * Gives a boundary pin whose direction is only a convention the direction its
 * definition-backed loads and drivers imply. A Platform Designer conduit export
 * counts as an input (`conduit end`) or an output (`conduit start`) unless the
 * exporting component's definition makes the data direction clear; a pin of
 * unknown direction takes a clear one too. Pure: returns a new graph and never
 * mutates its input. No vscode imports.
 */

import type { PinDirection, SystemGraph, SystemPin } from '../../../domain/systemGraph';
import { directionForRole, endpointRole } from '../../../domain/systemGraphRoles';

function isConvention(pin: SystemPin): boolean {
  return (
    pin.direction === 'unknown' ||
    (pin.interfaceType === 'conduit' && pin.directionSource === 'declared')
  );
}

/** The direction every defined endpoint of the pin's nets implies, or undefined when unclear. */
function impliedDirection(
  graph: SystemGraph,
  levelPath: string,
  pin: SystemPin
): PinDirection | undefined {
  const roles = new Set<'source' | 'sink'>();
  for (const net of graph.nets) {
    if (
      net.level !== levelPath ||
      !net.endpoints.some((end) => end.instance === null && end.pin === pin.name)
    ) {
      continue;
    }
    for (const end of net.endpoints) {
      const defined = end.instance
        ? graph.instances[end.instance]?.pins.find((candidate) => candidate.name === end.pin)
        : undefined;
      if (defined?.directionSource !== 'definition') {
        continue;
      }
      const role = endpointRole(defined.direction, false);
      if (role !== 'none') {
        roles.add(role);
      }
    }
  }
  if (roles.size !== 1) {
    return undefined;
  }
  // Seen from inside the level, a pin that is driven by an instance loads the net.
  const [role] = roles;
  return directionForRole(role === 'source' ? 'sink' : 'source', pin.isInterface, true);
}

/** `/` is 0, `/h` 1, `/h/x` 2. */
function depthOf(levelPath: string): number {
  return levelPath === '/' ? 0 : levelPath.split('/').length - 1;
}

export function applyExportDirections(graph: SystemGraph): SystemGraph {
  const result = JSON.parse(JSON.stringify(graph)) as SystemGraph;
  // Deepest first: a hierarchy pin whose direction is resolved is a defined endpoint of its parent.
  const levels = Object.values(result.levels).sort((a, b) => depthOf(b.path) - depthOf(a.path));
  for (const level of levels) {
    for (const pin of level.boundaryPins) {
      const direction = isConvention(pin) ? impliedDirection(result, level.path, pin) : undefined;
      if (direction === undefined) {
        continue;
      }
      pin.direction = direction;
      pin.directionSource = 'definition';
      // The hierarchy block shows the same pin to its parent level.
      const outer = result.instances[level.path]?.pins.find((p) => p.name === pin.name);
      if (outer) {
        outer.direction = direction;
        outer.directionSource = 'definition';
      }
    }
  }
  return result;
}
