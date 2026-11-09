import type { PortField } from '../../types/ipCore';

type PortFieldMap = Record<string, PortField[]>;

/** `{ fields }` when the list is non-empty, else `{}` (empty lists are never written). */
export function fieldsProp(fields: PortField[] | undefined): { fields?: PortField[] } {
  return fields && fields.length > 0 ? { fields } : {};
}

/** Builds a `portFields` map from `[key, fields]` pairs; undefined when no pair has fields. */
export function collectPortFields(
  entries: Iterable<readonly [string, PortField[] | undefined]>
): PortFieldMap | undefined {
  const map: PortFieldMap = {};
  for (const [key, fields] of entries) {
    if (fields && fields.length > 0) {
      map[key] = fields;
    }
  }
  return Object.keys(map).length > 0 ? map : undefined;
}

/** Merges `incoming` over `existing` (incoming keys win); undefined when both are empty. */
export function mergePortFields(
  existing: PortFieldMap | undefined,
  incoming: PortFieldMap | undefined
): PortFieldMap | undefined {
  const merged = { ...(existing ?? {}), ...(incoming ?? {}) };
  return Object.keys(merged).length > 0 ? merged : undefined;
}

/** Looks up the fields of a logical port name, ignoring case. */
export function portFieldsForLogical(
  portFields: PortFieldMap | undefined,
  logicalName: string
): PortField[] | undefined {
  if (!portFields) {
    return undefined;
  }
  const wanted = logicalName.toLowerCase();
  const key = Object.keys(portFields).find((candidate) => candidate.toLowerCase() === wanted);
  return key === undefined ? undefined : portFields[key];
}
