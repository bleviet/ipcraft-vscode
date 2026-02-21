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
  return str.replace(/_([a-z])/g, (_: string, letter: string) => letter.toUpperCase());
}
