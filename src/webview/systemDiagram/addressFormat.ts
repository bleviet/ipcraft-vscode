/** Pure display formatters for address-map cells. */

const HEX = /^0x[0-9a-f]+$/i;
const DIGITS_PER_GROUP = 4;
const UNITS: [string, bigint][] = [
  ['T', BigInt(1) << BigInt(40)],
  ['G', BigInt(1) << BigInt(30)],
  ['M', BigInt(1) << BigInt(20)],
  ['K', BigInt(1) << BigInt(10)],
];

/** `0x40400000` -> `0x4040_0000`: upper-case digits padded to 4-digit groups; non-hex text unchanged. */
export function groupHex(text: string): string {
  if (!HEX.test(text)) {
    return text;
  }
  const digits = text.slice(2).toUpperCase();
  const padded = digits.padStart(
    Math.ceil(digits.length / DIGITS_PER_GROUP) * DIGITS_PER_GROUP,
    '0'
  );
  return `0x${padded.match(/.{4}/g)?.join('_') ?? padded}`;
}

/** `0x10000` -> `64K`; only exact multiples of 1024 are humanized, else grouped hex. */
export function formatRange(text: string): string {
  if (!HEX.test(text)) {
    return text;
  }
  const size = BigInt(text);
  const unit = UNITS.find(([, bytes]) => size >= bytes && size % bytes === BigInt(0));
  return unit ? `${size / unit[1]}${unit[0]}` : groupHex(text);
}
