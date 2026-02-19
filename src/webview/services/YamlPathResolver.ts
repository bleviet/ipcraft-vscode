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
      if (cursor == null) {
        throw new Error(`Path not found at ${String(key)}`);
      }
      cursor = (cursor as Record<string | number, unknown>)[key];
    }
    const last = path[path.length - 1];
    if (cursor == null) {
      throw new Error(`Path not found at ${String(last)}`);
    }
    (cursor as Record<string | number, unknown>)[last] = value;
  }

  /**
   * Get a value at a specific path in the YAML structure
   */
  static getAtPath(root: unknown, path: YamlPath): unknown {
    let cursor: unknown = root;
    for (const key of path) {
      if (cursor == null) {
        return undefined;
      }
      cursor = (cursor as Record<string | number, unknown>)[key];
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
      if (cursor == null) {
        return;
      }
      cursor = (cursor as Record<string | number, unknown>)[key];
    }
    const last = path[path.length - 1];
    if (cursor == null) {
      return;
    }
    if (Array.isArray(cursor) && typeof last === 'number') {
      cursor.splice(last, 1);
      return;
    }
    delete (cursor as Record<string | number, unknown>)[last];
  }

  /**
   * Determine the root structure of the memory map YAML
   * Handles both standalone maps and maps nested in arrays or objects
   */
  static getMapRootInfo(data: unknown): MapRootInfo {
    if (Array.isArray(data)) {
      return { root: data, selectionRootPath: [0], map: data[0] };
    }
    if (data && typeof data === 'object' && Array.isArray((data as Record<string, unknown>).memory_maps)) {
      return { root: data, selectionRootPath: ['memory_maps', 0], map: ((data as Record<string, unknown>).memory_maps as unknown[])[0] };
    }
    return { root: data, selectionRootPath: [], map: data };
  }
}
