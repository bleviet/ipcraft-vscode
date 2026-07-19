import { formatValue } from '../../../dataInspector/formatValue';
import { parseLiteral } from '../../../dataInspector/parseLiteral';

describe('formatValue', () => {
  const known = parseLiteral("16'h00A5").vector;

  it('formats values without HDL literal syntax', () => {
    expect(formatValue(known, 'hex')).toBe('0x00A5');
    expect(formatValue(known, 'binary')).toBe('0b0000000010100101');
    expect(formatValue(known, 'decimal')).toBe('165');
  });

  it('falls back to binary when the requested representation cannot preserve unknown bits', () => {
    const mixedUnknowns = parseLiteral("4'b01XZ").vector;

    expect(formatValue(mixedUnknowns, 'hex')).toBe('0b01XZ');
    expect(formatValue(mixedUnknowns, 'decimal')).toBe('0b01XZ');
  });
});
