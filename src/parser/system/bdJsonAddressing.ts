/**
 * The root `addressing` object of a JSON `.bd` file: master address spaces and
 * their segments, mapped onto the address segments the Tcl reader produces
 * from `assign_bd_address`.
 */

import { asRecord, type JsonRecord } from './bdJsonPins';
import type { LineOf } from './BdJsonReader';
import { joinPath, type SystemGraphBuilder } from './bdTclGraphBuilder';

const SIZE_UNITS = 'KMGT';

/** `64K` -> `0x00010000` (binary multiples); anything else as written. */
function sizeToHex(range: string): string {
  const match = /^(\d+)([KMGT])$/.exec(range);
  if (!match) {
    return range;
  }
  const bytes = BigInt(match[1]) << BigInt(10 * (SIZE_UNITS.indexOf(match[2]) + 1));
  return `0x${bytes.toString(16).toUpperCase().padStart(8, '0')}`;
}

/** Reads one master (`/sys_ps7`) with its address spaces. */
function addMaster(
  builder: SystemGraphBuilder,
  lineOf: LineOf,
  master: string,
  node: JsonRecord,
  excludedLines: number[]
): void {
  for (const [space, spaceValue] of Object.entries(asRecord(node.address_spaces) ?? {})) {
    const segments = asRecord(asRecord(spaceValue)?.segments) ?? {};
    for (const [name, value] of Object.entries(segments)) {
      const segment = asRecord(value);
      const block = segment?.address_block;
      if (!segment || typeof block !== 'string') {
        continue;
      }
      const line = lineOf([
        'design',
        'addressing',
        master,
        'address_spaces',
        space,
        'segments',
        name,
      ]);
      if (String(segment.is_excluded).toUpperCase() === 'TRUE') {
        excludedLines.push(line);
        continue;
      }
      const masterPath = joinPath('/', master);
      const parts = joinPath('/', block).slice(1).split('/').filter(Boolean);
      const offset = segment.offset;
      const range = segment.range;
      builder.addAddressSegment({
        addressSpace: `${masterPath.slice(1)}/${space}`,
        segment: parts.join('/'),
        masterInstance: masterPath,
        slaveInstance: parts.length > 2 ? joinPath('/', parts.slice(0, -2).join('/')) : '',
        ...(typeof offset === 'string' && { offset }),
        ...(typeof range === 'string' && { range: sizeToHex(range) }),
        line,
      });
    }
  }
}

export function addBdJsonAddressing(
  builder: SystemGraphBuilder,
  lineOf: LineOf,
  addressing: JsonRecord | undefined
): void {
  const excludedLines: number[] = [];
  for (const [master, value] of Object.entries(addressing ?? {})) {
    const node = asRecord(value);
    if (node) {
      addMaster(builder, lineOf, master, node, excludedLines);
    }
  }
  excludedLines.forEach((line) =>
    builder.report('info', 'Skipped excluded address segments', line)
  );
}
