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
  /**
   * Per-signal substitution for the `*` wildcard in `physicalNamePattern`. When the pattern
   * contains `*` (e.g. `asi_{signal}_{index}_*`), each signal's `*` resolves to its captured
   * decoration — letting one template cover signals whose trailing tag varies (Avalon-ST sinks
   * where `valid`/`data` carry `_i` but `ready` carries `_o`). Signals absent from the map
   * resolve `*` to the empty string. Only a single `*` is supported.
   */
  wildcardMatches?: Record<string, string>;
}

/** The signal token for a logical name: explicit override, else lowercased logical name. */
export function resolveSignalToken(
  logicalName: string,
  portNameOverrides?: Record<string, string>
): string {
  return portNameOverrides?.[logicalName] ?? logicalName.toLowerCase();
}

/**
 * Format an array instance index into the physical-naming token, honouring an optional
 * zero-pad width. `{index}` is the bare number; `{index:N}` zero-pads to N digits
 * (e.g. `12` with N=4 -> `0012`), so zero-padded HDL indices (`asi_valid_00_i`) survive
 * a generate -> parse round-trip losslessly instead of being collapsed to a single digit.
 */
export function formatIndex(index: number, width?: number): string {
  const s = String(index);
  return width && width > 1 ? s.padStart(width, '0') : s;
}

/** Match an `{index}` or `{index:N}` placeholder; capture group 1 is the width (or undefined). */
const INDEX_RE = /\{index(?::(\d+))?\}/g;
/** The bare placeholder, for callers that build templates positionally. */
export const INDEX_PLACEHOLDER = '{index}';

/**
 * Resolve the physical HDL port name for a logical bus signal.
 *
 * When `physicalNamePattern` is set it takes precedence and `{signal}` / `{index}` are
 * substituted. A `*` wildcard in the pattern is resolved per-signal from
 * `config.wildcardMatches[logicalName]` (default empty), so one template covers signals whose
 * trailing decoration varies (e.g. `_i` vs `_o` direction tags within one interface). When
 * `index` is omitted, an `{index}` placeholder is left intact so callers can detect an
 * unresolved (still-array) template.
 */
export function resolvePhysicalPortName(
  logicalName: string,
  config: PhysicalNameConfig,
  index?: number
): string {
  const signal = resolveSignalToken(logicalName, config.portNameOverrides);
  const pattern = config.physicalNamePattern;
  if (pattern) {
    const out = substitutePattern(pattern, signal, index);
    if (!out.includes('*')) {
      return out;
    }
    // Case-insensitive lookup: the canvas keys on the bus-def signal name (lowercase for
    // Avalon), while the generator keys on the uppercase logical name. Both must resolve.
    const wildcard = resolveWildcard(config.wildcardMatches, logicalName);
    return out.replace(/\*/g, wildcard);
  }
  return `${config.physicalPrefix ?? ''}${signal}`;
}

/** Case-insensitive lookup of a logical signal's `*` substitution. */
function resolveWildcard(matches: Record<string, string> | undefined, logicalName: string): string {
  if (!matches) {
    return '';
  }
  if (Object.prototype.hasOwnProperty.call(matches, logicalName)) {
    return matches[logicalName];
  }
  const upper = logicalName.toUpperCase();
  if (Object.prototype.hasOwnProperty.call(matches, upper)) {
    return matches[upper];
  }
  const lower = logicalName.toLowerCase();
  if (Object.prototype.hasOwnProperty.call(matches, lower)) {
    return matches[lower];
  }
  return '';
}

/**
 * Substitute `{signal}` (and `{index}` when provided) into a name pattern.
 *
 * `{index}` may carry a zero-pad width as `{index:N}` (N digits); bare `{index}` produces the
 * un-padded number. When `index` is undefined the `{index}` placeholder is left in place so
 * array templates can be detected by their unresolved placeholder.
 */
export function substitutePattern(pattern: string, signal: string, index?: number): string {
  const out = pattern.replace(/\{signal\}/g, signal);
  if (index === undefined) {
    return out;
  }
  return out.replace(INDEX_RE, (_, width) => formatIndex(index, width ? Number(width) : undefined));
}

/**
 * Substitute only the `{index}` placeholder (with optional width) into a template that has no
 * `{signal}` placeholder — used for `array.namingPattern` and the legacy `physicalPrefixPattern`,
 * which name array instances rather than individual ports. Leaves `{signal}` untouched.
 */
export function substituteIndex(pattern: string, index: number): string {
  return pattern.replace(INDEX_RE, (_, width) =>
    formatIndex(index, width ? Number(width) : undefined)
  );
}

/**
 * Build a `RegExp` that matches a physical port name against a `physicalNamePattern` with `*`
 * wildcards, `{signal}` and `{index:N}` placeholders resolved for a specific signal and (optional)
 * index. Used by importers/canvas to recognize decorated port names (`asi_valid_0_i`) against a
 * template whose trailing tag varies (`asi_{signal}_{index}_*`). Returns null when the pattern
 * has no placeholders or wildcards (plain literal match is sufficient).
 */
export function matchPhysicalName(pattern: string, signal: string, index?: number): RegExp | null {
  if (!pattern.includes('{') && !pattern.includes('*')) {
    return null;
  }
  let sigIndexPart = pattern.replace(/\{signal\}/g, escapeRegex(signal));
  if (index !== undefined) {
    sigIndexPart = sigIndexPart.replace(INDEX_RE, (_, width) =>
      escapeRegex(formatIndex(index, width ? Number(width) : undefined))
    );
  } else {
    sigIndexPart = sigIndexPart.replace(INDEX_RE, '\\d+');
  }
  const re = sigIndexPart.replace(/\*/g, '.*');
  return new RegExp(`^${re}$`);
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
