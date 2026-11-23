import type { MemoryMapRootStyle } from './internal.types';

export interface MemoryMapRootEntry {
  /** YAML path of the map object from the document root (`[]` for a standalone map). */
  path: (string | number)[];
  raw: Record<string, unknown>;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

/**
 * Classifies a parsed `.mm.yml` root and lists every memory map in it with its YAML path:
 * a bare map (`standalone`), a top-level list (`array`), or `{ memoryMaps: [...] }` (`nested`).
 */
export function detectMemoryMapRoot(rootObj: unknown): {
  rootStyle: MemoryMapRootStyle;
  maps: MemoryMapRootEntry[];
} {
  if (Array.isArray(rootObj)) {
    return {
      rootStyle: 'array',
      maps: rootObj.map((raw, index) => ({ path: [index], raw: asRecord(raw) })),
    };
  }
  const record = asRecord(rootObj);
  if (Array.isArray(record.memoryMaps)) {
    return {
      rootStyle: 'nested',
      maps: record.memoryMaps.map((raw: unknown, index) => ({
        path: ['memoryMaps', index],
        raw: asRecord(raw),
      })),
    };
  }
  return { rootStyle: 'standalone', maps: [{ path: [], raw: record }] };
}
