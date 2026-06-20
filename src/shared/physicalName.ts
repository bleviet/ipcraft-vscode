/**
 * Physical port-name resolution — single source of truth shared by the generator,
 * the importers, and the webview canvas.
 *
 * A bus interface's physical port names are resolved from one of two models:
 *
 *  1. `physicalNamePattern` (preferred, general): a template string with placeholders
 *     `{signal}` and `{index}`. Every other character is literal, so direction tags and
 *     any decoration (`_i`, `_in`, ...) need no special handling, and the per-instance
 *     index can sit anywhere in the name, not just the prefix.
 *
 *  2. `physicalPrefix` (legacy): the physical name is `physicalPrefix + signalSuffix`.
 *     This is the special case `physicalNamePattern: "<prefix>{signal}"`.
 *
 * `{signal}` resolves to `portNameOverrides[logicalName]` when present, else
 * `logicalName.toLowerCase()` — identical to the long-standing convention.
 */

export interface PhysicalNameConfig {
  physicalNamePattern?: string | null;
  physicalPrefix?: string | null;
  portNameOverrides?: Record<string, string>;
}

/** The signal token for a logical name: explicit override, else lowercased logical name. */
export function resolveSignalToken(
  logicalName: string,
  portNameOverrides?: Record<string, string>
): string {
  return portNameOverrides?.[logicalName] ?? logicalName.toLowerCase();
}

/**
 * Resolve the physical HDL port name for a logical bus signal.
 *
 * When `physicalNamePattern` is set it takes precedence and `{signal}` / `{index}` are
 * substituted. When `index` is omitted, an `{index}` placeholder is left intact so callers
 * can detect an unresolved (still-array) template.
 */
export function resolvePhysicalPortName(
  logicalName: string,
  config: PhysicalNameConfig,
  index?: number
): string {
  const signal = resolveSignalToken(logicalName, config.portNameOverrides);
  const pattern = config.physicalNamePattern;
  if (pattern) {
    return substitutePattern(pattern, signal, index);
  }
  return `${config.physicalPrefix ?? ''}${signal}`;
}

/** Substitute `{signal}` (and `{index}` when provided) into a name pattern. */
export function substitutePattern(pattern: string, signal: string, index?: number): string {
  let out = pattern.replace(/\{signal\}/g, signal);
  if (index !== undefined) {
    out = out.replace(/\{index\}/g, String(index));
  }
  return out;
}
