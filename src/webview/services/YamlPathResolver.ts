/**
 * Type representing a YAML path as an array of keys/indices
 */
export type YamlPath = Array<string | number>;

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
      cursor = obj[key];
    }
    const last = path[path.length - 1];
    if (cursor === null || cursor === undefined) {
      throw new Error(`Path not found at ${String(last)}`);
    }
    const obj = cursor as Record<string | number, unknown>;
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
      cursor = obj[key];
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
      cursor = obj[key];
    }
    const last = path[path.length - 1];
    if (cursor === null || cursor === undefined) {
      return;
    }
    const obj = cursor as Record<string | number, unknown>;
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
    const memoryMaps = (data as Record<string, unknown> | null | undefined)?.memoryMaps;
    if (Array.isArray(memoryMaps)) {
      return { root: data, selectionRootPath: ['memoryMaps', 0], map: memoryMaps[0] };
    }
    return { root: data, selectionRootPath: [], map: data };
  }
}
