import type { IpCore as DomainIpCore } from '../../../domain/ipcore.types';
import type { NormalizedBusLibrary } from '../../../shared/busContracts';
import type { IpcraftIssue } from '../../../shared/issues';
import {
  enumeratePortFieldLists,
  portFieldRange,
  type PortFieldBitRange,
  type PortFieldList,
} from '../../../shared/portFields';
import type { IpCore } from '../../types/ipCore';

type Range = PortFieldBitRange;

const ENUM_KEY = /^(?:0x[0-9a-f]+|\d+)$/i;

function enumValueProblem(key: string, bitWidth: number): string | null {
  if (!ENUM_KEY.test(key.trim())) {
    return `value '${key}' is not a non-negative integer`;
  }
  return BigInt(key.trim()) >= BigInt(1) << BigInt(bitWidth)
    ? `value ${key} does not fit in ${bitWidth} bits`
    : null;
}

function checkFieldList(list: PortFieldList): IpcraftIssue[] {
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
        ...(list.busInterface !== undefined ? { interfaceName: list.busInterface } : {}),
      });
    };
    const where = `${list.portName}.${field.name}`;

    if (seenNames.has(field.name)) {
      issue('PORT_FIELD_DUPLICATE_NAME', `${list.portName}: duplicate field name ${field.name}`);
    }
    seenNames.add(field.name);

    const range = portFieldRange(field);
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
        `${list.portName}: fields ${list.fields[earlier].name} and ${field.name} overlap at bit ${Math.max(other.lsb, range.lsb)}`
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

function checkBusKey(list: PortFieldList): IpcraftIssue[] {
  if (!list.keyProblem) {
    return [];
  }
  const bus = list.busInterface;
  const key = list.portName;
  const code =
    list.keyProblem === 'unknown' ? 'PORT_FIELDS_UNKNOWN_PORT' : 'PORT_FIELDS_INACTIVE_PORT';
  const message =
    list.keyProblem === 'inactive'
      ? `${bus}.portFields: ${key} is not enabled on this interface`
      : `${bus}.portFields: ${key} is not a port of ${list.contractKey ?? 'this interface'}`;
  return [
    {
      code,
      severity: 'warning',
      source: 'portFields',
      path: [...list.path],
      message,
      interfaceName: bus,
    },
  ];
}

/**
 * Warnings for port field metadata (`ports[].fields`, `conduitPorts[].fields`,
 * `busInterfaces[].portFields`). Never blocks generation.
 */
export function checkPortFields(
  ipCore: IpCore,
  library: NormalizedBusLibrary | undefined
): IpcraftIssue[] {
  return enumeratePortFieldLists(ipCore as unknown as DomainIpCore, library).flatMap((list) => [
    ...checkBusKey(list),
    ...checkFieldList(list),
  ]);
}
