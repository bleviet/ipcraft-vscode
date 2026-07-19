import { BitState, BitVector, MAX_BIT_VECTOR_WIDTH, MIN_BIT_VECTOR_WIDTH } from './BitVector';

const BIGINT_ZERO = BigInt(0);
const BIGINT_ONE = BigInt(1);

export type LiteralRadix = 'binary' | 'hex' | 'decimal';

export interface ParseLiteralOptions {
  radix?: LiteralRadix | 'auto';
  width?: number;
  signed?: boolean;
}

export interface ParsedLiteral {
  vector: BitVector;
  originalText: string;
  radix: LiteralRadix;
  warnings: string[];
}

type ParsedSyntax = {
  digits: string;
  radix: LiteralRadix;
  declaredWidth?: number;
};

function syntax(text: string, requestedRadix: LiteralRadix | 'auto'): ParsedSyntax {
  const verilog = /^(\d+)'([bBdDhH])([0-9a-fA-F_xXzZlLhHuUwW-]+)$/.exec(text);
  if (verilog) {
    const radix =
      verilog[2].toLowerCase() === 'b'
        ? 'binary'
        : verilog[2].toLowerCase() === 'h'
          ? 'hex'
          : 'decimal';
    return { digits: verilog[3], radix, declaredWidth: Number(verilog[1]) };
  }

  const vhdl = /^([xXbB])"([0-9a-fA-F_xXzZlLhHuUwW-]+)"$/.exec(text);
  if (vhdl) {
    return { digits: vhdl[2], radix: vhdl[1].toLowerCase() === 'x' ? 'hex' : 'binary' };
  }

  if (/^0[xX]/.test(text)) {
    return { digits: text.slice(2), radix: 'hex' };
  }
  if (/^0[bB]/.test(text)) {
    return { digits: text.slice(2), radix: 'binary' };
  }
  if (requestedRadix !== 'auto') {
    return { digits: text, radix: requestedRadix };
  }
  if (/^-\d[\d_]*$/.test(text)) {
    return { digits: text, radix: 'decimal' };
  }
  if (/^[01_xXzZlLhHuUwW-]+$/.test(text)) {
    return { digits: text, radix: 'binary' };
  }
  if (/[a-fA-FxXzZ]/.test(text)) {
    return { digits: text, radix: 'hex' };
  }
  return { digits: text, radix: 'decimal' };
}

function validateWidth(width: number): void {
  if (!Number.isInteger(width) || width < MIN_BIT_VECTOR_WIDTH || width > MAX_BIT_VECTOR_WIDTH) {
    throw new Error(
      `Width must be an integer from ${MIN_BIT_VECTOR_WIDTH} to ${MAX_BIT_VECTOR_WIDTH}`
    );
  }
}

function normalizeBinaryDigit(digit: string, warnings: Set<string>): BitState {
  const upper = digit.toUpperCase();
  if (upper === '0' || upper === '1' || upper === 'X' || upper === 'Z') {
    return upper === '0' ? 0 : upper === '1' ? 1 : upper;
  }
  if (upper === 'L' || upper === 'H') {
    warnings.add('Weak L/H states were normalized to 0/1');
    return upper === 'L' ? 0 : 1;
  }
  if (upper === 'U' || upper === 'W' || upper === '-') {
    warnings.add('Weak U/W/- states were normalized to X');
    return 'X';
  }
  throw new Error(`Invalid binary digit "${digit}"`);
}

function parseBinary(
  digits: string,
  width: number | undefined,
  warnings: Set<string>,
  allowZeroExtension: boolean
): BitVector {
  const compact = digits.replace(/_/g, '');
  if (!compact) {
    throw new Error('A binary literal must contain digits');
  }
  let bits = Array.from(compact, (digit) => normalizeBinaryDigit(digit, warnings));
  const targetWidth = width ?? bits.length;
  validateWidth(targetWidth);
  if (allowZeroExtension && bits.length < targetWidth) {
    bits = [...Array<BitState>(targetWidth - bits.length).fill(0), ...bits];
  }
  if (bits.length !== targetWidth) {
    throw new Error(
      `Binary literal has ${bits.length} bits but width is ${targetWidth}; choose an explicit extension or truncation`
    );
  }
  return BitVector.fromBits(bits);
}

function parseHex(
  digits: string,
  width: number | undefined,
  allowZeroExtension: boolean
): BitVector {
  const compact = digits.replace(/_/g, '');
  if (!compact || !/^[0-9a-fA-FxXzZ]+$/.test(compact)) {
    throw new Error('A hexadecimal literal may contain only hexadecimal, X, or Z digits');
  }
  const bits: BitState[] = [];
  for (const digit of compact) {
    const upper = digit.toUpperCase();
    if (upper === 'X' || upper === 'Z') {
      bits.push(upper, upper, upper, upper);
    } else {
      const value = Number.parseInt(upper, 16);
      bits.push(
        (value & 8) === 0 ? 0 : 1,
        (value & 4) === 0 ? 0 : 1,
        (value & 2) === 0 ? 0 : 1,
        (value & 1) === 0 ? 0 : 1
      );
    }
  }
  const targetWidth = width ?? bits.length;
  validateWidth(targetWidth);
  if (allowZeroExtension && bits.length < targetWidth) {
    bits.unshift(...Array<BitState>(targetWidth - bits.length).fill(0));
  }
  if (bits.length !== targetWidth) {
    throw new Error(
      `Hexadecimal literal has ${bits.length} bits but width is ${targetWidth}; choose an explicit extension or truncation`
    );
  }
  return BitVector.fromBits(bits);
}

function parseDecimal(digits: string, width: number | undefined, signed: boolean): BitVector {
  const compact = digits.replace(/_/g, '');
  if (!/^-?\d+$/.test(compact)) {
    throw new Error('Invalid decimal literal');
  }
  if (width === undefined) {
    throw new Error('Decimal input requires an explicit width');
  }
  validateWidth(width);
  const value = BigInt(compact);
  if (value < BIGINT_ZERO && !signed) {
    throw new Error('Negative decimal input requires a signed interpretation');
  }
  const min = signed ? -(BIGINT_ONE << BigInt(width - 1)) : BIGINT_ZERO;
  const max = signed
    ? (BIGINT_ONE << BigInt(width - 1)) - BIGINT_ONE
    : (BIGINT_ONE << BigInt(width)) - BIGINT_ONE;
  if (value < min || value > max) {
    throw new Error(`Decimal value does not fit in ${signed ? 'signed ' : ''}${width} bits`);
  }
  const encoded = value < BIGINT_ZERO ? (BIGINT_ONE << BigInt(width)) + value : value;
  return BitVector.fromBigInt(encoded, width);
}

export function parseLiteral(text: string, options: ParseLiteralOptions = {}): ParsedLiteral {
  const originalText = text;
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error('Enter a value to inspect');
  }
  const parsed = syntax(trimmed, options.radix ?? 'auto');
  if (
    parsed.declaredWidth !== undefined &&
    options.width !== undefined &&
    parsed.declaredWidth !== options.width
  ) {
    throw new Error(`Literal declares ${parsed.declaredWidth} bits but width is ${options.width}`);
  }
  const width = parsed.declaredWidth ?? options.width;
  const allowZeroExtension = width !== undefined;
  const warnings = new Set<string>();
  const vector =
    parsed.radix === 'binary'
      ? parseBinary(parsed.digits, width, warnings, allowZeroExtension)
      : parsed.radix === 'hex'
        ? parseHex(parsed.digits, width, allowZeroExtension)
        : parseDecimal(parsed.digits, width, options.signed === true);
  return { vector, originalText, radix: parsed.radix, warnings: [...warnings] };
}
