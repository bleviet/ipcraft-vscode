/**
 * Utility functions for converting between camelCase and snake_case.
 *
 * Critical for IP Core YAML handling:
 * - YAML uses camelCase (physicalPort, busInterfaces, etc.)
 * - Pydantic models use snake_case (physical_port, bus_interfaces, etc.)
 */

/**
 * Convert camelCase string to snake_case
 *
 * @example toSnakeCase('physicalPort') => 'physical_port'
 * @example toSnakeCase('memoryMapRef') => 'memory_map_ref'
 */
export function toSnakeCase(str: string): string {
  return str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

/**
 * Convert snake_case string to camelCase
 *
 * @example toCamelCase('physical_port') => 'physicalPort'
 * @example toCamelCase('memory_map_ref') => 'memoryMapRef'
 */
export function toCamelCase(str: string): string {
  return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}

/**
 * Recursively convert object keys from snake_case to camelCase
 * Used when converting pydantic model data to YAML format
 */
export function mapKeysToCamelCase(obj: any): any {
  if (obj === null || obj === undefined) {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(mapKeysToCamelCase);
  }

  if (typeof obj === 'object') {
    const result: any = {};
    for (const [key, value] of Object.entries(obj)) {
      const camelKey = toCamelCase(key);
      result[camelKey] = mapKeysToCamelCase(value);
    }
    return result;
  }

  return obj;
}

/**
 * Recursively convert object keys from camelCase to snake_case
 * Used when converting YAML data to match pydantic model structure
 */
export function mapKeysToSnakeCase(obj: any): any {
  if (obj === null || obj === undefined) {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(mapKeysToSnakeCase);
  }

  if (typeof obj === 'object') {
    const result: any = {};
    for (const [key, value] of Object.entries(obj)) {
      const snakeKey = toSnakeCase(key);
      result[snakeKey] = mapKeysToSnakeCase(value);
    }
    return result;
  }

  return obj;
}

/**
 * Known camelCase -> snake_case mappings for IP Core YAML
 * Used for validation and autocomplete
 */
export const KNOWN_MAPPINGS = {
  // Top level
  apiVersion: 'api_version',
  useBusLibrary: 'use_bus_library',
  busInterfaces: 'bus_interfaces',
  memoryMaps: 'memory_maps',
  fileSets: 'file_sets',

  // Clock/Reset/Port
  logicalName: 'logical_name',

  // Bus Interface
  physicalPrefix: 'physical_prefix',
  associatedClock: 'associated_clock',
  associatedReset: 'associated_reset',
  memoryMapRef: 'memory_map_ref',
  useOptionalPorts: 'use_optional_ports',
  portWidthOverrides: 'port_width_overrides',
  indexStart: 'index_start',
  namingPattern: 'naming_pattern',
  physicalPrefixPattern: 'physical_prefix_pattern',

  // Parameter
  dataType: 'data_type',

  // Memory Map
  addressBlocks: 'address_blocks',
  baseAddress: 'base_address',

  // Register
  addressOffset: 'address_offset',
  resetValue: 'reset_value',

  // Bit Field
  bitOffset: 'bit_offset',
  bitWidth: 'bit_width',
  bitRange: 'bit_range',
} as const;
