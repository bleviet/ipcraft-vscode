/**
 * Pure helpers for `_hw.tcl` port elaboration effects: `set_port_property`
 * (TERMINATION, WIDTH, WIDTH_EXPR) and the post-processing that drops disabled
 * ports and placeholder widths before interfaces are classified.
 */

import { evaluateTclCondition, resolveTclWidth } from './hwTclExpr';

export interface TclInterface {
  name: string;
  type: string;
  mode: string;
  properties: Map<string, string>;
  ports: TclPort[];
}

export interface TclPort {
  portName: string;
  logicalName: string;
  direction: string;
  /** undefined when the width used Tcl that could not be resolved; the port is kept without a width. */
  width: number | string | undefined;
  /** Set by `set_port_property <port> TERMINATION true`; terminated ports are dropped. */
  terminated?: boolean;
}

/**
 * Applies one `set_port_property` to every port named `portName`, mutating the
 * port. Returns warnings. In unresolved mode (the statement sits under a
 * condition that could not be evaluated) the static declaration is kept.
 */
export function applyPortProperty(
  interfaces: ReadonlyMap<string, TclInterface>,
  portName: string,
  property: string,
  value: string,
  paramNames: ReadonlySet<string>,
  paramValues: ReadonlyMap<string, number>,
  unresolved: boolean
): string[] {
  const prop = property.toUpperCase();
  if (prop !== 'TERMINATION' && prop !== 'WIDTH' && prop !== 'WIDTH_EXPR') {
    return [];
  }
  const warnings: string[] = [];
  for (const iface of interfaces.values()) {
    for (const port of iface.ports) {
      if (port.portName !== portName) {
        continue;
      }
      if (unresolved) {
        warnings.push(
          `Port "${portName}" on interface "${iface.name}": ${prop} is changed under a condition that could not be evaluated, so the static declaration was kept.`
        );
      } else if (prop === 'TERMINATION') {
        const literal = value.trim().toLowerCase();
        const terminated =
          literal === 'true' || literal === '1'
            ? true
            : literal === 'false' || literal === '0'
              ? false
              : evaluateTclCondition(value, paramValues);
        if (terminated === null) {
          warnings.push(
            `Port "${portName}" on interface "${iface.name}": ${property} "${value}" could not be resolved, so the static termination was kept.`
          );
        } else {
          port.terminated = terminated;
        }
      } else {
        const width = resolveTclWidth(value, paramNames);
        if (width === undefined) {
          warnings.push(
            `Port "${portName}" on interface "${iface.name}": ${property} "${value}" could not be resolved, so the static width was kept as a placeholder.`
          );
        } else {
          port.width = width;
        }
      }
    }
  }
  return warnings;
}

/**
 * Removes ports and interfaces the elaboration disables: terminated ports, ports
 * whose width is 0 (literally or through a parameter defaulting to 0), and
 * interfaces left with no ports. A negative width (the Platform Designer `-1`
 * placeholder) is cleared. Returns new interfaces plus warnings; inputs are not mutated.
 */
export function finalizeInterfaces(
  interfaces: ReadonlyMap<string, TclInterface>,
  paramValues: ReadonlyMap<string, number>
): { interfaces: Map<string, TclInterface>; warnings: string[] } {
  const warnings: string[] = [];
  const result = new Map<string, TclInterface>();
  for (const [key, iface] of interfaces) {
    const ports: TclPort[] = [];
    for (const port of iface.ports) {
      if (port.terminated) {
        continue;
      }
      const { width } = port;
      const disabledBy =
        width === 0
          ? '0'
          : typeof width === 'string' && paramValues.get(width) === 0
            ? width
            : null;
      if (disabledBy !== null) {
        warnings.push(
          width === 0
            ? `Port "${port.portName}" on interface "${iface.name}" was dropped: its width is 0.`
            : `Port "${port.portName}" on interface "${iface.name}" was dropped: it is disabled by default because parameter "${disabledBy}" defaults to 0.`
        );
        continue;
      }
      if (typeof width === 'number' && width < 0) {
        warnings.push(
          `Port "${port.portName}" on interface "${iface.name}": placeholder width ${width} was left out because no elaboration set a width.`
        );
        ports.push({ ...port, width: undefined });
      } else {
        ports.push(port);
      }
    }
    if (iface.ports.length === 0 || ports.length > 0) {
      result.set(key, { ...iface, ports });
    }
  }
  return { interfaces: result, warnings };
}
