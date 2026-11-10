import * as path from 'path';
import type { IpCore } from '../domain/ipcore.types';
import type { NormalizedBusLibrary } from '../shared/busContracts';
import type { RegisterLayoutCopy } from '../shared/messages/dataInspector';
import { enumeratePortFieldLists, portFieldRange } from '../shared/portFields';
import type { InspectorField } from './fieldLayout';
import { uniqueStableId } from './stableId';

/** Largest source width a recipe accepts. */
const MAX_SOURCE_WIDTH = 4096;

/**
 * One layout per port that has at least one usable field. Bus ports need a
 * library; unknown or inactive bus keys, a bus key whose port already has a
 * layout, ports whose width does not resolve, and malformed, out-of-range or
 * overlapping fields are skipped.
 */
export function copyPortLayouts(
  relativePath: string,
  ipCore: IpCore,
  library: NormalizedBusLibrary | undefined
): RegisterLayoutCopy[] {
  const layouts: RegisterLayoutCopy[] = [];
  const seenIds = new Set<string>();
  for (const list of enumeratePortFieldLists(ipCore, library)) {
    const { width } = list;
    if (
      width === undefined ||
      !Number.isInteger(width) ||
      width < 1 ||
      width > MAX_SOURCE_WIDTH ||
      list.keyProblem
    ) {
      continue;
    }
    const usedIds = new Set<string>();
    const fields: InspectorField[] = [];
    list.fields.forEach((field, index) => {
      const range = portFieldRange(field);
      if (
        typeof range === 'string' ||
        range.msb >= width ||
        fields.some((other) => other.lsb <= range.msb && range.lsb <= other.msb)
      ) {
        return;
      }
      const id = uniqueStableId(`import-${index}-${field.name}`, usedIds);
      usedIds.add(id);
      fields.push({
        id,
        name: field.name,
        msb: range.msb,
        lsb: range.lsb,
        groupId: 'default',
        description: field.description,
        enumValues: field.enumeratedValues ? { ...field.enumeratedValues } : undefined,
      });
    });
    if (fields.length === 0) {
      continue;
    }
    const portName = list.canonicalPortName ?? list.portName;
    const scoped = list.busInterface ? `${list.busInterface}/${portName}` : portName;
    const id = `${relativePath}:${list.kind}:${scoped}`;
    if (seenIds.has(id)) {
      continue;
    }
    seenIds.add(id);
    layouts.push({
      id,
      // A conduit port may share its name with a logical port of the same bus.
      label: `${path.basename(relativePath)} · ${scoped}${list.kind === 'conduit' ? ' (conduit)' : ''}`,
      kind: 'port',
      width,
      fields,
      sourceFile: relativePath,
      provenance: {
        sourceFile: relativePath,
        portName,
        ...(list.busInterface ? { busInterface: list.busInterface } : {}),
      },
    });
  }
  return layouts;
}
