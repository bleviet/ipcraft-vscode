export type BitState = 0 | 1 | 'X' | 'Z';

export const MIN_BIT_VECTOR_WIDTH = 1;
export const MAX_BIT_VECTOR_WIDTH = 4096;
const BIGINT_ZERO = BigInt(0);
const BIGINT_ONE = BigInt(1);

function assertWidth(width: number): void {
  if (!Number.isInteger(width) || width < MIN_BIT_VECTOR_WIDTH || width > MAX_BIT_VECTOR_WIDTH) {
    throw new RangeError(
      `Bit vector width must be an integer from ${MIN_BIT_VECTOR_WIDTH} to ${MAX_BIT_VECTOR_WIDTH}`
    );
  }
}

function stateToCode(state: BitState): number {
  if (state === 'X') {
    return 2;
  }
  if (state === 'Z') {
    return 3;
  }
  return state;
}

function codeToState(code: number): BitState {
  if (code === 0 || code === 1) {
    return code;
  }
  return code === 3 ? 'Z' : 'X';
}

function computedState(state: BitState): 0 | 1 | 'X' {
  return state === 0 || state === 1 ? state : 'X';
}

/** Immutable, fixed-width vector whose internal bit order is least-significant first. */
export class BitVector {
  private readonly storage: Uint8Array;

  private constructor(storage: Uint8Array) {
    assertWidth(storage.length);
    this.storage = storage;
  }

  static fromBits(bitsMsbFirst: readonly BitState[]): BitVector {
    assertWidth(bitsMsbFirst.length);
    const storage = new Uint8Array(bitsMsbFirst.length);
    for (let index = 0; index < bitsMsbFirst.length; index++) {
      storage[bitsMsbFirst.length - index - 1] = stateToCode(bitsMsbFirst[index]);
    }
    return new BitVector(storage);
  }

  static fromBigInt(value: bigint, width: number): BitVector {
    assertWidth(width);
    if (value < BIGINT_ZERO || value >= BIGINT_ONE << BigInt(width)) {
      throw new RangeError(`Value does not fit in ${width} bits`);
    }
    const storage = new Uint8Array(width);
    for (let bit = 0; bit < width; bit++) {
      storage[bit] = Number((value >> BigInt(bit)) & BIGINT_ONE);
    }
    return new BitVector(storage);
  }

  static filled(width: number, state: BitState): BitVector {
    assertWidth(width);
    const storage = new Uint8Array(width);
    storage.fill(stateToCode(state));
    return new BitVector(storage);
  }

  get width(): number {
    return this.storage.length;
  }

  get hasUnknown(): boolean {
    return this.storage.some((code) => code > 1);
  }

  bit(index: number): BitState {
    if (!Number.isInteger(index) || index < 0 || index >= this.width) {
      throw new RangeError(`Bit ${index} is outside [${this.width - 1}:0]`);
    }
    return codeToState(this.storage[index]);
  }

  withBit(index: number, state: BitState): BitVector {
    this.bit(index);
    const storage = this.storage.slice();
    storage[index] = stateToCode(state);
    return new BitVector(storage);
  }

  bitsMsbFirst(): BitState[] {
    return Array.from(this.storage, codeToState).reverse();
  }

  toBigInt(): bigint | null {
    if (this.hasUnknown) {
      return null;
    }
    let value = BIGINT_ZERO;
    for (let bit = 0; bit < this.width; bit++) {
      if (this.storage[bit] === 1) {
        value |= BIGINT_ONE << BigInt(bit);
      }
    }
    return value;
  }

  toBinary(): string {
    return this.bitsMsbFirst().join('');
  }

  toHex(): string | null {
    if (this.width % 4 !== 0) {
      return null;
    }
    let result = '';
    for (let high = this.width - 1; high >= 0; high -= 4) {
      const nibble = [this.bit(high), this.bit(high - 1), this.bit(high - 2), this.bit(high - 3)];
      if (nibble.every((state) => state === 'X')) {
        result += 'X';
      } else if (nibble.every((state) => state === 'Z')) {
        result += 'Z';
      } else if (nibble.every((state) => state === 0 || state === 1)) {
        const value = nibble.reduce<number>((sum, state) => sum * 2 + Number(state), 0);
        result += value.toString(16).toUpperCase();
      } else {
        return null;
      }
    }
    return result;
  }

  toLiteral(preferredRadix: 'binary' | 'hex' = 'hex'): string {
    const hex = preferredRadix === 'hex' ? this.toHex() : null;
    return hex === null ? `${this.width}'b${this.toBinary()}` : `${this.width}'h${hex}`;
  }

  equals(other: BitVector): boolean {
    return (
      this.width === other.width &&
      this.storage.every((code, index) => code === other.storage[index])
    );
  }

  concat(low: BitVector): BitVector {
    assertWidth(this.width + low.width);
    return BitVector.fromBits([...this.bitsMsbFirst(), ...low.bitsMsbFirst()]);
  }

  slice(msb: number, lsb: number): BitVector {
    if (
      !Number.isInteger(msb) ||
      !Number.isInteger(lsb) ||
      lsb < 0 ||
      msb < lsb ||
      msb >= this.width
    ) {
      throw new RangeError(`Slice [${msb}:${lsb}] is outside [${this.width - 1}:0]`);
    }
    const storage = this.storage.slice(lsb, msb + 1);
    return new BitVector(storage);
  }

  and(other: BitVector): BitVector {
    return this.combine(other, (left, right) => {
      if (left === 0 || right === 0) {
        return 0;
      }
      return left === 1 && right === 1 ? 1 : 'X';
    });
  }

  or(other: BitVector): BitVector {
    return this.combine(other, (left, right) => {
      if (left === 1 || right === 1) {
        return 1;
      }
      return left === 0 && right === 0 ? 0 : 'X';
    });
  }

  xor(other: BitVector): BitVector {
    return this.combine(other, (left, right) => {
      const knownLeft = computedState(left);
      const knownRight = computedState(right);
      return knownLeft === 'X' || knownRight === 'X' ? 'X' : ((knownLeft ^ knownRight) as 0 | 1);
    });
  }

  not(): BitVector {
    return BitVector.fromBits(
      this.bitsMsbFirst().map((state) => {
        const known = computedState(state);
        return known === 'X' ? 'X' : known === 0 ? 1 : 0;
      })
    );
  }

  shiftLeft(amount: number): BitVector {
    this.assertShift(amount);
    if (amount >= this.width) {
      return BitVector.filled(this.width, 0);
    }
    const storage = new Uint8Array(this.width);
    storage.set(this.storage.slice(0, this.width - amount), amount);
    return new BitVector(storage);
  }

  shiftRight(amount: number): BitVector {
    this.assertShift(amount);
    if (amount >= this.width) {
      return BitVector.filled(this.width, 0);
    }
    const storage = new Uint8Array(this.width);
    storage.set(this.storage.slice(amount));
    return new BitVector(storage);
  }

  zeroExtend(width: number): BitVector {
    this.assertExtensionWidth(width);
    const storage = new Uint8Array(width);
    storage.set(this.storage);
    return new BitVector(storage);
  }

  signExtend(width: number): BitVector {
    this.assertExtensionWidth(width);
    const storage = new Uint8Array(width);
    storage.set(this.storage);
    const sign = computedState(this.bit(this.width - 1));
    storage.fill(stateToCode(sign), this.width);
    return new BitVector(storage);
  }

  truncate(width: number): BitVector {
    assertWidth(width);
    if (width >= this.width) {
      throw new RangeError(`Truncation width must be less than ${this.width}`);
    }
    return new BitVector(this.storage.slice(0, width));
  }

  byteSwap(): BitVector {
    if (this.width % 8 !== 0) {
      throw new RangeError('Byte swap requires a whole number of bytes');
    }
    const bytes: BitState[][] = [];
    const bits = this.bitsMsbFirst();
    for (let index = 0; index < bits.length; index += 8) {
      bytes.push(bits.slice(index, index + 8));
    }
    return BitVector.fromBits(bytes.reverse().flat());
  }

  reverseBits(): BitVector {
    return BitVector.fromBits(this.bitsMsbFirst().reverse());
  }

  private combine(
    other: BitVector,
    operation: (left: BitState, right: BitState) => BitState
  ): BitVector {
    if (this.width !== other.width) {
      throw new RangeError(`Operands must have equal widths (${this.width} != ${other.width})`);
    }
    const otherBits = other.bitsMsbFirst();
    return BitVector.fromBits(
      this.bitsMsbFirst().map((state, index) => operation(state, otherBits[index]))
    );
  }

  private assertShift(amount: number): void {
    if (!Number.isInteger(amount) || amount < 0) {
      throw new RangeError('Shift amount must be a non-negative integer');
    }
  }

  private assertExtensionWidth(width: number): void {
    assertWidth(width);
    if (width <= this.width) {
      throw new RangeError(`Extension width must be greater than ${this.width}`);
    }
  }
}
