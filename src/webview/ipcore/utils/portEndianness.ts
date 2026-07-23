/**
 * Endianness (byte order) is meaningful only for a directional vector port whose bytes
 * can be reversed. It never applies to:
 *   - an `inout` port (no single reflow direction), or
 *   - a scalar (`std_logic` / 1-bit) port.
 *
 * A fixed width must be a whole number of bytes (a multiple of 8). A parameterized
 * (string) width is treated as applicable because it may resolve to a byte multiple at
 * elaboration; the generated HDL guards that with a runtime assertion.
 *
 * Single source of truth for the endianness control's enabled state across the Ports
 * table and the canvas port inspector.
 */
export function portEndiannessApplies(
  width: number | string | undefined,
  direction: string | undefined
): boolean {
  if (direction === 'inout') {
    return false;
  }
  if (typeof width === 'string') {
    return width.trim().length > 0;
  }
  return typeof width === 'number' && width > 1 && width % 8 === 0;
}
