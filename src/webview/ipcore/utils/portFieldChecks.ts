import type { BusInterface as DomainBusInterface, Parameter } from '../../../domain/ipcore.types';
import {
  createParameterContext,
  isPortActive,
  resolveBusInterface,
  resolveNumericValue,
  type NormalizedBusLibrary,
  type ParameterContext,
} from '../../../shared/busContracts';
import type { IpcraftIssue } from '../../../shared/issues';
import type { BusInterface, IpCore, PortField } from '../../types/ipCore';
import { parseBitsRange } from '../../utils/BitFieldUtils';

interface FieldList {
  /** Name used in messages, e.g. the port name or the logical port name. */
  label: string;
  fields: readonly PortField[];
  /** Path of the field array; a field index is appended per issue. */
  path: readonly (string | number)[];
  width: number | undefined;
  interfaceName?: string;
}

interface Range {
  msb: number;
  lsb: number;
}

const ENUM_KEY = /^(?:0x[0-9a-f]+|\d+)$/i;

function resolveWidth(raw: unknown, context: ParameterContext): number | undefined {
  return resolveNumericValue(raw ?? 1, context).value;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

/** The field's bit range, or a reason string when its position is malformed. */
function fieldRange(field: PortField): Range | string {
  const hasBits = field.bits !== undefined && field.bits !== null;
  const hasOffset = field.offset !== undefined && field.offset !== null;
  const hasWidth = field.width !== undefined && field.width !== null;
  if (hasBits && (hasOffset || hasWidth)) {
    return 'use bits or offset/width, not both';
  }
  if (hasBits) {
    const parsed = parseBitsRange(String(field.bits));
    if (!parsed) {
      return `bits '${String(field.bits)}' is not a valid range`;
    }
    return { msb: Math.max(...parsed), lsb: Math.min(...parsed) };
  }
  if (hasOffset && hasWidth) {
    if (!isNonNegativeInteger(field.offset) || !isNonNegativeInteger(field.width) || !field.width) {
      return 'offset must be a non-negative integer and width a positive integer';
    }
    return { msb: field.offset + field.width - 1, lsb: field.offset };
  }
  return 'use bits or offset/width';
}

function enumValueProblem(key: string, bitWidth: number): string | null {
  if (!ENUM_KEY.test(key.trim())) {
    return `value '${key}' is not a non-negative integer`;
  }
  return BigInt(key.trim()) >= BigInt(1) << BigInt(bitWidth)
    ? `value ${key} does not fit in ${bitWidth} bits`
    : null;
}

function checkFieldList(list: FieldList): IpcraftIssue[] {
  const issues: IpcraftIssue[] = [];
  const ranges: Array<Range | undefined> = [];
  const seenNames = new Set<string>();

  list.fields.forEach((field, j) => {
    const path = [...list.path, j];
    const issue = (code: string, message: string, extra: (string | number)[] = []): void => {
      issues.push({
        code,
        severity: 'warning',
        source: 'portFields',
        path: [...path, ...extra],
        message,
        ...(list.interfaceName !== undefined ? { interfaceName: list.interfaceName } : {}),
      });
    };
    const where = `${list.label}.${field.name}`;

    if (seenNames.has(field.name)) {
      issue('PORT_FIELD_DUPLICATE_NAME', `${list.label}: duplicate field name ${field.name}`);
    }
    seenNames.add(field.name);

    const range = fieldRange(field);
    if (typeof range === 'string') {
      issue('PORT_FIELD_POSITION', `${where}: ${range}`);
      ranges.push(undefined);
      return;
    }
    ranges.push(range);

    if (list.width !== undefined && range.msb >= list.width) {
      issue(
        'PORT_FIELD_RANGE',
        `${where} [${range.msb}:${range.lsb}] exceeds port width ${list.width}`
      );
    }

    const earlier = ranges.findIndex(
      (other, i) => i < j && other && other.lsb <= range.msb && range.lsb <= other.msb
    );
    if (earlier >= 0) {
      const other = ranges[earlier] as Range;
      issue(
        'PORT_FIELD_OVERLAP',
        `${list.label}: fields ${list.fields[earlier].name} and ${field.name} overlap at bit ${Math.max(other.lsb, range.lsb)}`
      );
    }

    const bitWidth = range.msb - range.lsb + 1;
    for (const key of Object.keys(field.enumeratedValues ?? {})) {
      const problem = enumValueProblem(key, bitWidth);
      if (problem) {
        issue('PORT_FIELD_ENUM_VALUE', `${where}: ${problem}`, ['enumeratedValues', key]);
      }
    }
  });
  return issues;
}

function checkBusPortFields(
  bus: BusInterface,
  busIndex: number,
  parameters: readonly Parameter[],
  library: NormalizedBusLibrary
): IpcraftIssue[] {
  const entries = Object.entries(bus.portFields ?? {});
  if (entries.length === 0) {
    return [];
  }
  const resolution = resolveBusInterface({
    busInterface: bus as unknown as DomainBusInterface,
    busIndex,
    parameters,
    library,
  });
  const contract = resolution.match?.contract;
  const rawPortMaps = (bus as { rawPortMaps?: Array<{ logical: string; width: number }> })
    .rawPortMaps;
  const canKeyCheck = contract !== undefined || (rawPortMaps?.length ?? 0) > 0;

  const issues: IpcraftIssue[] = [];
  for (const [key, fields] of entries) {
    const lower = key.toLowerCase();
    const path = ['busInterfaces', busIndex, 'portFields', key];
    const portIssue = (code: string, message: string): void => {
      issues.push({
        code,
        severity: 'warning',
        source: 'portFields',
        path,
        message,
        interfaceName: bus.name,
      });
    };
    let width: number | undefined;
    if (contract) {
      const port = contract.ports.find((candidate) => candidate.name.toLowerCase() === lower);
      if (!port) {
        portIssue(
          'PORT_FIELDS_UNKNOWN_PORT',
          `${bus.name}.portFields: ${key} is not a port of ${contract.key}`
        );
      } else {
        width = resolution.portWidths[port.name]?.value;
        if (!isPortActive(port, resolution.canonicalBusInterface ?? (bus as never))) {
          portIssue(
            'PORT_FIELDS_INACTIVE_PORT',
            `${bus.name}.portFields: ${key} is not enabled on this interface`
          );
        }
      }
    } else if (canKeyCheck) {
      const raw = rawPortMaps?.find((map) => map.logical.toLowerCase() === lower);
      if (!raw) {
        portIssue(
          'PORT_FIELDS_UNKNOWN_PORT',
          `${bus.name}.portFields: ${key} is not a port of this interface`
        );
      } else {
        width = raw.width;
      }
    }
    issues.push(
      ...checkFieldList({
        label: key,
        fields,
        path,
        width,
        interfaceName: bus.name,
      })
    );
  }
  return issues;
}

/**
 * Warnings for port field metadata (`ports[].fields`, `conduitPorts[].fields`,
 * `busInterfaces[].portFields`). Never blocks generation.
 */
export function checkPortFields(
  ipCore: IpCore,
  library: NormalizedBusLibrary | undefined
): IpcraftIssue[] {
  const parameters = (ipCore.parameters ?? []) as unknown as readonly Parameter[];
  const context = createParameterContext(parameters);
  const issues: IpcraftIssue[] = [];

  (ipCore.ports ?? []).forEach((port, i) => {
    if (port.fields?.length) {
      issues.push(
        ...checkFieldList({
          label: port.name,
          fields: port.fields,
          path: ['ports', i, 'fields'],
          width: resolveWidth(port.width, context),
        })
      );
    }
  });

  (ipCore.busInterfaces ?? []).forEach((bus, b) => {
    const conduitPorts = Array.isArray(bus.conduitPorts) ? bus.conduitPorts : [];
    conduitPorts.forEach((port, c) => {
      if (port.fields?.length) {
        issues.push(
          ...checkFieldList({
            label: port.name,
            fields: port.fields,
            path: ['busInterfaces', b, 'conduitPorts', c, 'fields'],
            width: resolveWidth(port.width, context),
            interfaceName: bus.name,
          })
        );
      }
    });
    if (library) {
      issues.push(...checkBusPortFields(bus, b, parameters, library));
    }
  });
  return issues;
}
