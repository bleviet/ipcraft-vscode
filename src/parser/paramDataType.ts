/**
 * Canonicalises a parameter `dataType` to one of the values allowed by the IP
 * core schema's `ParameterType` enum (`integer`, `natural`, `boolean`,
 * `string`).
 *
 * HDL sources express numeric generics with richer types than the schema
 * carries. We collapse them to the closest canonical type, preserving the
 * non-negative constraint where it exists:
 *   - `positive`, `natural`, `unsigned` -> `natural`
 *   - `integer`, `signed`, anything else numeric -> `integer`
 *
 * Constrained subtypes such as `natural range 12 to 64` or `unsigned(7 downto 0)`
 * have their range/index clause stripped before matching.
 */
export function normalizeParameterDataType(rawType: string | undefined): string {
  const t = String(rawType ?? '')
    .replace(/\s+range\s+.*/i, '')
    .replace(/\s*\(.*\)\s*$/, '')
    .trim()
    .toLowerCase();

  if (t === 'boolean') {
    return 'boolean';
  }
  if (t === 'string') {
    return 'string';
  }
  if (t === 'natural' || t === 'positive' || t === 'unsigned') {
    return 'natural';
  }
  return 'integer';
}
