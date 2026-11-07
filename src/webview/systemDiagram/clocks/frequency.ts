/** Clock frequency text: parsing what scripts and definitions write, formatting for the UI. */

const UNIT_HZ: Record<string, number> = { '': 1, hz: 1, khz: 1e3, mhz: 1e6, ghz: 1e9 };
const FREQUENCY = /^(\d+\.?\d*(?:e[+-]?\d+)?|\.\d+(?:e[+-]?\d+)?)\s*(hz|khz|mhz|ghz)?$/i;

/** Hz from `100MHz`, `100 MHz`, `1.5GHz`, `50kHz`, `100000000` or `100e6`; undefined when unparsable. */
export function parseFrequency(text: string): number | undefined {
  const match = FREQUENCY.exec(text.trim());
  if (!match) {
    return undefined;
  }
  const hz = Number(match[1]) * UNIT_HZ[(match[2] ?? '').toLowerCase()];
  // Rounding drops float noise such as 32.768 * 1000 = 32768.00000000001.
  return Number.isFinite(hz) ? Number(hz.toPrecision(12)) : undefined;
}

/** `100 MHz`, `1.5 GHz`, `32.768 kHz`, `50 Hz`. At most 3 decimals. */
export function formatHz(hz: number): string {
  const [scale, unit] =
    hz >= 1e9 ? [1e9, 'GHz'] : hz >= 1e6 ? [1e6, 'MHz'] : hz >= 1e3 ? [1e3, 'kHz'] : [1, 'Hz'];
  return `${Number((hz / scale).toFixed(3))} ${unit}`;
}

/** `name · 100 MHz`, or the name alone when the script sets no frequency. */
export function nameWithFrequency(
  domain: { name: string; hz?: number },
  separator = ' · '
): string {
  return domain.hz === undefined ? domain.name : `${domain.name}${separator}${formatHz(domain.hz)}`;
}
