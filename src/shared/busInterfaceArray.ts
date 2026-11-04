/**
 * Naming rule for arrayed bus interfaces (`busInterfaces[].array`): the one
 * place that turns one authored interface into the per-index names and
 * physical prefixes. Shared by the generator and the system viewer. Pure.
 */

export interface BusInterfaceArrayConfig {
  count?: number | null;
  indexStart?: number | null;
  namingPattern?: string | null;
  physicalPrefixPattern?: string | null;
}

export interface ArrayedBusName {
  name: string;
  physicalPrefix: string;
}

/** Names and prefixes of the expanded interfaces, with the generator's defaults. */
export function arrayedBusNames(iface: {
  name?: unknown;
  physicalPrefix?: string | null;
  array: BusInterfaceArrayConfig;
}): ArrayedBusName[] {
  const arrayDef = iface.array;
  const count = Number(arrayDef.count ?? 1);
  const start = Number(arrayDef.indexStart ?? 0);
  const names: ArrayedBusName[] = [];
  for (let i = 0; i < count; i += 1) {
    const idx = start + i;
    const namePattern = arrayDef.namingPattern ?? `${String(iface.name)}_{index}`;
    const prefixPattern =
      arrayDef.physicalPrefixPattern ?? `${String(iface.physicalPrefix ?? '')}{index}_`;
    names.push({
      name: String(namePattern).replace('{index}', String(idx)),
      physicalPrefix: String(prefixPattern).replace('{index}', String(idx)),
    });
  }
  return names;
}
