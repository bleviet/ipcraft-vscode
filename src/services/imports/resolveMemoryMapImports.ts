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
    const absPath = path.resolve(baseDir, importField);
    try {
      const text = await reader.readText(absPath);
      const parsed = yaml.load(text);
      let loaded: Record<string, unknown>[] = [];
      if (Array.isArray(parsed)) {
        loaded = parsed as Record<string, unknown>[];
      } else if (parsed && typeof parsed === 'object') {
        loaded = [parsed as Record<string, unknown>];
      }
      return { resolved: loaded, errors };
    } catch (err) {
      const msg = `Failed to load memory map from ${importField}: ${(err as Error).message}`;
      errors.push(msg);
      return { resolved: [memoryMaps as Record<string, unknown>], errors };
    }
  }

  const entries = (Array.isArray(memoryMaps) ? memoryMaps : [memoryMaps]) as unknown[];

  for (const entry of entries) {
    if (isObjectWithImport(entry)) {
      const importField = entry.import;
      const absPath = path.resolve(baseDir, importField);
      try {
        const text = await reader.readText(absPath);
        const parsed = yaml.load(text);
        const loaded: Record<string, unknown> = Array.isArray(parsed)
          ? ((parsed[0] as Record<string, unknown>) ?? {})
          : ((parsed as Record<string, unknown>) ?? {});

        const { import: _ignored, ...entryWithoutImport } = entry;
        resolved.push({ ...loaded, ...entryWithoutImport });
      } catch (err) {
        const msg = `Failed to load memory map from ${importField}: ${(err as Error).message}`;
        errors.push(msg);
        resolved.push(entry as Record<string, unknown>);
      }
    } else if (entry && typeof entry === 'object') {
      resolved.push(entry as Record<string, unknown>);
    }
  }

  return { resolved, errors };
}
