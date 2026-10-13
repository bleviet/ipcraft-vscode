/**
 * A register value is stored in its bit fields, so bits that no field covers
 * would be dropped on commit. These helpers let the register Value bar report
 * that instead of silently losing them, and give a fieldless register its own
 * storage (`RegisterDef.resetValue`).
 */
import {
  describeConstantFieldMismatches,
  findUnstorableBitRanges,
  formatBitRanges,
  registerResetToBitVector,
} from '../../../webview/components/bitfield/utils';
import type { FieldModel } from '../../../webview/components/BitFieldVisualizer';
import { BitVector } from '../../../dataInspector/BitVector';

function field(name: string, hi: number, lo: number): FieldModel {
  return { name, offset: lo, width: hi - lo + 1, bitRange: [hi, lo] };
}

function value(hex: string, width = 32): BitVector {
  return BitVector.fromBigInt(BigInt(hex), width);
}

describe('findUnstorableBitRanges', () => {
  it('reports nothing when every set bit is covered by a field', () => {
    const fields = [field('LOW', 3, 0), field('MID', 7, 4)];
    expect(findUnstorableBitRanges(fields, value('0xA5'))).toEqual([]);
  });

  it('reports the uncovered range above the fields', () => {
    const fields = [field('LOW', 3, 0)];
    expect(findUnstorableBitRanges(fields, value('0xA5A5'))).toEqual([[31, 4]]);
  });

  it('ignores an uncovered range whose bits are all zero', () => {
    const fields = [field('LOW', 3, 0)];
    expect(findUnstorableBitRanges(fields, value('0x5'))).toEqual([]);
  });

  it('reports the whole register when it has no fields', () => {
    expect(findUnstorableBitRanges([], value('0x9'))).toEqual([[31, 0]]);
    expect(findUnstorableBitRanges([], value('0x0'))).toEqual([]);
  });

  it('does not count a field the writer skips as covering its bits', () => {
    // hi >= width is skipped by applyRegisterBitVectorToFields, so its bits
    // are not actually stored.
    const fields = [field('OVERFLOW', 40, 0)];
    expect(findUnstorableBitRanges(fields, value('0x1'))).toEqual([[31, 0]]);
  });

  it('reports only the gaps that carry data', () => {
    const fields = [field('LOW', 3, 0), field('HIGH', 11, 8)];
    // 0xF0 sets bits 7:4 (the gap); 31:12 stays zero and is not reported.
    expect(findUnstorableBitRanges(fields, value('0xF0'))).toEqual([[7, 4]]);
  });

  it('reports several data-carrying gaps, ascending by lsb', () => {
    const fields = [field('LOW', 3, 0), field('HIGH', 11, 8)];
    expect(findUnstorableBitRanges(fields, value('0x100F0'))).toEqual([
      [7, 4],
      [31, 12],
    ]);
  });
});

describe('formatBitRanges', () => {
  it('renders a range as hi:lo', () => {
    expect(formatBitRanges([[31, 8]])).toBe('31:8');
  });

  it('renders a single bit without a colon', () => {
    expect(formatBitRanges([[3, 3]])).toBe('3');
  });

  it('lists disjoint ranges from the most significant down', () => {
    expect(
      formatBitRanges([
        [3, 3],
        [10, 8],
      ])
    ).toBe('10:8, 3');
  });

  it('returns an empty string for no ranges', () => {
    expect(formatBitRanges([])).toBe('');
  });
});

describe('registerResetToBitVector', () => {
  it('reads the register reset value at the register width', () => {
    expect(registerResetToBitVector(0xa5a5, 32).toBigInt()).toBe(BigInt(0xa5a5));
  });

  it('treats a missing reset value as zero', () => {
    expect(registerResetToBitVector(undefined, 32).toBigInt()).toBe(BigInt(0));
    expect(registerResetToBitVector(null, 32).toBigInt()).toBe(BigInt(0));
  });

  it('masks a value wider than the register', () => {
    expect(registerResetToBitVector(0x1ff, 8).toBigInt()).toBe(BigInt(0xff));
  });

  it('accepts a bigint beyond the safe integer range', () => {
    const wide = BigInt('0xFFFFFFFFFFFFFFFF');
    expect(registerResetToBitVector(wide, 64).toBigInt()).toBe(wide);
  });
});

describe('describeConstantFieldMismatches', () => {
  const major: FieldModel = { ...field('MAJOR', 23, 16), versionRef: '$version.major' };
  const minor: FieldModel = { ...field('MINOR', 15, 8), versionRef: '$version.minor' };
  const plain = field('LOW', 7, 0);

  it('reports nothing when the token fields keep their bits', () => {
    const current = value('0x010400');
    expect(describeConstantFieldMismatches([major, minor, plain], current, value('0x0104FF'))).toBe(
      null
    );
  });

  it('names the changed token field, its reference and its current value', () => {
    expect(
      describeConstantFieldMismatches([major, minor, plain], value('0x010400'), value('0x020400'))
    ).toBe('Bits 23:16 hold $version.major (0x01)');
  });

  it('reports every changed token field', () => {
    expect(
      describeConstantFieldMismatches([major, minor], value('0x010400'), value('0x020500'))
    ).toBe('Bits 23:16 hold $version.major (0x01); Bits 15:8 hold $version.minor (0x04)');
  });

  it('compares against 0 when the version is unresolved', () => {
    expect(describeConstantFieldMismatches([major], value('0x000000'), value('0x010000'))).toBe(
      'Bits 23:16 hold $version.major (0x00)'
    );
  });

  it('ignores fields without a version reference', () => {
    expect(describeConstantFieldMismatches([plain], value('0x00'), value('0xFF'))).toBeNull();
  });
});
