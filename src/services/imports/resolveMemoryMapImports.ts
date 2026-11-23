import * as path from 'path';
import * as yaml from 'js-yaml';

export interface FileReader {
  readText(absPath: string): Promise<string>;
}

export interface ResolveMemoryMapImportsOptions {
  memoryMaps: unknown;
  baseDir: string;
  reader: FileReader;
}

export interface ResolveMemoryMapImportsResult {
  resolved: Record<string, unknown>[];
  errors: string[];
}

/** The absolute path a memory map `import` value points at, relative to the importing file's dir. */
export function resolveMemoryMapImportPath(baseDir: string, importField: string): string {
  return path.resolve(baseDir, importField);
}

export interface ImportedMap {
  /** The map object as generation loads it (entry overrides already merged in). */
  raw: Record<string, unknown>;
  /** YAML path of the map inside the imported file (`[]` for the root object). */
  path: (string | number)[];
}

/**
 * The maps generation loads from one parsed imported `.mm.yml`: the single source of truth for
 * which maps an import contributes. Without `entryOverrides` (the `memoryMaps: { import }`
 * shortcut) every entry of a list file is a map, and any other object is one map. With them (an
 * array entry `- import: ...`) only the first map is loaded, with the entry's other keys merged
 * over it. A `{ memoryMaps: [...] }` root is one root object, like any other object.
 */
export function selectImportedMaps(
  parsed: unknown,
  entryOverrides?: Record<string, unknown>
): ImportedMap[] {
  if (entryOverrides === undefined) {
    if (Array.isArray(parsed)) {
      return parsed.map((raw, index) => ({ raw: raw as Record<string, unknown>, path: [index] }));
    }
    return parsed && typeof parsed === 'object'
      ? [{ raw: parsed as Record<string, unknown>, path: [] }]
      : [];
  }
  const first: unknown = Array.isArray(parsed) ? (parsed[0] as unknown) : parsed;
  const loaded = (first ?? {}) as Record<string, unknown>;
  return [{ raw: { ...loaded, ...entryOverrides }, path: Array.isArray(parsed) ? [0] : [] }];
}

/**
 * Unified resolver for memory map imports (.mm.yml).
 * Resolves legacy shortcut objects, per-entry imports, merges entry-level overrides,
 * and collects failures into an error array.
 */
export async function resolveMemoryMapImports({
  memoryMaps,
  baseDir,
  reader,
}: ResolveMemoryMapImportsOptions): Promise<ResolveMemoryMapImportsResult> {
  const errors: string[] = [];
  const resolved: Record<string, unknown>[] = [];

  if (!memoryMaps) {
    return { resolved, errors };
  }

  const isObjectWithImport = (val: unknown): val is { import: string; [key: string]: unknown } => {
    return (
      val !== null &&
      typeof val === 'object' &&
      'import' in val &&
      typeof (val as Record<string, unknown>).import === 'string'
    );
  };

  // Legacy shortcut format: memoryMaps: { import: "file.mm.yml" }
  if (!Array.isArray(memoryMaps) && isObjectWithImport(memoryMaps)) {
    const importField = memoryMaps.import;
    const absPath = resolveMemoryMapImportPath(baseDir, importField);
    try {
      const text = await reader.readText(absPath);
      const parsed = yaml.load(text);
      return { resolved: selectImportedMaps(parsed).map((map) => map.raw), errors };
    } catch (err) {
      const msg = `Failed to load memory map from ${importField}: ${(err as Error).message}`;
      errors.push(msg);
      return { resolved: [memoryMaps], errors };
    }
  }

  const entries = (Array.isArray(memoryMaps) ? memoryMaps : [memoryMaps]) as unknown[];

  for (const entry of entries) {
    if (isObjectWithImport(entry)) {
      const importField = entry.import;
      const absPath = resolveMemoryMapImportPath(baseDir, importField);
      try {
        const text = await reader.readText(absPath);
        const parsed = yaml.load(text);
        const { import: _ignored, ...entryWithoutImport } = entry;
        resolved.push(selectImportedMaps(parsed, entryWithoutImport)[0].raw);
      } catch (err) {
        const msg = `Failed to load memory map from ${importField}: ${(err as Error).message}`;
        errors.push(msg);
        resolved.push(entry);
      }
    } else if (entry && typeof entry === 'object') {
      resolved.push(entry as Record<string, unknown>);
    }
  }

  return { resolved, errors };
}
