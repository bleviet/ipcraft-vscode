/**
 * Type representing a YAML path as an array of keys/indices
 */
export type YamlPath = Array<string | number>;

/**
 * Aliases for YAML keys that may appear in either camelCase or snake_case.
 * Allows path navigation to work regardless of the YAML format used.
 */
const KEY_ALIASES: Record<string, string> = {
  addressBlocks: 'addressBlocks',
};

/**
 * Resolve a path key against an object, falling back to its alias if needed.
 * Returns the key that actually exists in the object.
 */
function resolveKey(obj: Record<string | number, unknown>, key: string | number): string | number {
  if (key in obj) {
    return key;
  }
  if (typeof key === 'string' && KEY_ALIASES[key] !== undefined && KEY_ALIASES[key] in obj) {
    return KEY_ALIASES[key];
  }
  return key;
}

/**
 * Information about the memory map root in the YAML structure
 */
export interface MapRootInfo {
  root: unknown;
  selectionRootPath: YamlPath;
  map: unknown;
}

/**
 * Service for navigating and manipulating YAML data structures
 */
export class YamlPathResolver {
  /**
   * Set a value at a specific path in the YAML structure
   */
  static setAtPath(root: unknown, path: YamlPath, value: unknown): void {
    if (!path.length) {
      throw new Error('Cannot set empty path');
    }
    let cursor: unknown = root;
    for (let i = 0; i < path.length - 1; i++) {
      const key = path[i];
      if (cursor === null || cursor === undefined) {
        throw new Error(`Path not found at ${String(key)}`);
      }
      const obj = cursor as Record<string | number, unknown>;
      const resolvedKey = resolveKey(obj, key);
      cursor = obj[resolvedKey];
    }
    const lastRaw = path[path.length - 1];
    if (cursor === null || cursor === undefined) {
      throw new Error(`Path not found at ${String(lastRaw)}`);
    }
    const obj = cursor as Record<string | number, unknown>;
    const last = resolveKey(obj, lastRaw);
    obj[last] = value;
  }

  /**
   * Get a value at a specific path in the YAML structure
   */
  static getAtPath(root: unknown, path: YamlPath): unknown {
    let cursor: unknown = root;
    for (const key of path) {
      if (cursor === null || cursor === undefined) {
        return undefined;
      }
      const obj = cursor as Record<string | number, unknown>;
      const resolvedKey = resolveKey(obj, key);
      cursor = obj[resolvedKey];
    }
    return cursor;
  }

  /**
   * Delete a value at a specific path in the YAML structure
   */
  static deleteAtPath(root: unknown, path: YamlPath): void {
    if (!path.length) {
      return;
    }
    let cursor: unknown = root;
    for (let i = 0; i < path.length - 1; i++) {
      const key = path[i];
      if (cursor === null || cursor === undefined) {
        return;
      }
      const obj = cursor as Record<string | number, unknown>;
      const resolvedKey = resolveKey(obj, key);
      cursor = obj[resolvedKey];
    }
    const lastRaw = path[path.length - 1];
    if (cursor === null || cursor === undefined) {
      return;
    }
    const obj = cursor as Record<string | number, unknown>;
    const last = resolveKey(obj, lastRaw);
    if (Array.isArray(cursor) && typeof last === 'number') {
      cursor.splice(last, 1);
      return;
    }
    delete obj[last];
  }

  /**
   * Determine the root structure of the memory map YAML
   * Handles both standalone maps and maps nested in arrays or objects
   */
  static getMapRootInfo(data: unknown): MapRootInfo {
    if (Array.isArray(data)) {
      return { root: data, selectionRootPath: [0], map: data[0] };
    }
    if (
      data &&
      typeof data === 'object' &&
      Array.isArray((data as Record<string, unknown>).memory_maps)
    ) {
      return {
        root: data,
        selectionRootPath: ['memory_maps', 0],
        map: ((data as Record<string, unknown>).memory_maps as unknown[])[0],
      };
    }
    return { root: data, selectionRootPath: [], map: data };
  }
}
