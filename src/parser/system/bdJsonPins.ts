/**
 * Mapping of the JSON `.bd` pin and parameter objects onto {@link PinSpec} and
 * `CONFIG.*` parameter entries, with the semantics of the Tcl reader's
 * `create_bd_(intf_)(port|pin)`.
 */

import type { SignalType } from '../../domain/systemGraph';
import { INTERFACE_MODES, SCALAR_DIRECTIONS, SIGNAL_TYPES } from './bdTclCommands';
import type { PinSpec } from './bdTclGraphBuilder';

export type JsonRecord = Record<string, unknown>;

export function asRecord(value: unknown): JsonRecord | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : undefined;
}

/**
 * `CONFIG.<name>` entries for the parameters the user set. A parameter the
 * tool derived (`value_src` other than `user`, e.g. `default` or `propagated`)
 * is left out.
 */
export function readParameters(parameters: unknown): [string, string][] {
  const entries: [string, string][] = [];
  for (const [name, value] of Object.entries(asRecord(parameters) ?? {})) {
    const param = asRecord(value);
    if (
      param?.value === undefined ||
      (param.value_src !== undefined && param.value_src !== 'user')
    ) {
      continue;
    }
    // Vivado splits a long value into chunks at a space.
    const text = Array.isArray(param.value) ? param.value.join(' ') : String(param.value);
    entries.push([`CONFIG.${name}`, text]);
  }
  return entries;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/** The pin to declare for one `ports` / `interface_ports` entry. */
export function toPinSpec(
  name: string,
  pin: JsonRecord,
  isInterface: boolean,
  line: number
): PinSpec {
  const spec: PinSpec = {
    name,
    isInterface,
    direction: 'unknown',
    directionSource: 'declared',
    line,
  };
  if (isInterface) {
    spec.direction = INTERFACE_MODES[asString(pin.mode) ?? ''] ?? 'unknown';
    spec.vlnv = asString(pin.vlnv);
  } else {
    spec.direction = SCALAR_DIRECTIONS[asString(pin.direction) ?? ''] ?? 'unknown';
    const type = asString(pin.type);
    if (type && SIGNAL_TYPES.includes(type)) {
      spec.signalType = type as SignalType;
    }
    const from = Number(pin.left);
    const to = Number(pin.right);
    if (pin.left !== undefined && pin.right !== undefined && !isNaN(from) && !isNaN(to)) {
      spec.width = { from, to };
    }
  }
  if (spec.direction === 'unknown') {
    spec.directionSource = 'unknown';
  }
  const parameters = readParameters(pin.parameters);
  if (parameters.length > 0) {
    spec.parameters = Object.fromEntries(parameters);
  }
  return spec;
}
