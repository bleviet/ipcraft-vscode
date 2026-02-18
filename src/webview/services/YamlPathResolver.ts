/**
 * Type representing a YAML path as an array of keys/indices
 */
export type YamlPath = Array<string | number>;

/**
 * Information about the memory map root in the YAML structure
 */
export interface MapRootInfo {
  root: any;
  mapPrefix: YamlPath;
  map: any;
}

/**
 * Service for navigating and manipulating YAML data structures
 */
export class YamlPathResolver {
  /**
   * Set a value at a specific path in the YAML structure
   */
  static setAtPath(root: any, path: YamlPath, value: any): void {
    if (!path.length) {
      throw new Error('Cannot set empty path');
    }
    let cursor = root;
    for (let i = 0; i < path.length - 1; i++) {
      const key = path[i];
      if (cursor == null) {
        throw new Error(`Path not found at ${String(key)}`);
      }
      cursor = cursor[key as any];
    }
    const last = path[path.length - 1];
    if (cursor == null) {
      throw new Error(`Path not found at ${String(last)}`);
    }
    cursor[last as any] = value;
  }

  /**
   * Get a value at a specific path in the YAML structure
   */
  static getAtPath(root: any, path: YamlPath): any {
    let cursor = root;
    for (const key of path) {
      if (cursor == null) {
        return undefined;
      }
      cursor = cursor[key as any];
    }
    return cursor;
  }

  /**
   * Delete a value at a specific path in the YAML structure
   */
  static deleteAtPath(root: any, path: YamlPath): void {
    if (!path.length) {
      return;
    }
    let cursor = root;
    for (let i = 0; i < path.length - 1; i++) {
      const key = path[i];
      if (cursor == null) {
        return;
      }
      cursor = cursor[key as any];
    }
    const last = path[path.length - 1];
    if (cursor == null) {
      return;
    }
    if (Array.isArray(cursor) && typeof last === 'number') {
      cursor.splice(last, 1);
      return;
    }
    delete cursor[last as any];
  }

  /**
   * Determine the root structure of the memory map YAML
   * Handles both standalone maps and maps nested in arrays or objects
   */
  static getMapRootInfo(data: any): MapRootInfo {
    if (Array.isArray(data)) {
      return { root: data, mapPrefix: [0], map: data[0] };
    }
    if (data && typeof data === 'object' && Array.isArray(data.memory_maps)) {
      return { root: data, mapPrefix: ['memory_maps', 0], map: data.memory_maps[0] };
    }
    return { root: data, mapPrefix: [], map: data };
  }
}
