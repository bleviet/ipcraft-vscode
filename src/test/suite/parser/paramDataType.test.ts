import { normalizeParameterDataType } from '../../../parser/paramDataType';

describe('normalizeParameterDataType', () => {
  it('maps non-negative HDL numeric types to natural', () => {
    expect(normalizeParameterDataType('positive')).toBe('natural');
    expect(normalizeParameterDataType('natural')).toBe('natural');
    expect(normalizeParameterDataType('unsigned')).toBe('natural');
  });

  it('maps signed/generic numeric types to integer', () => {
    expect(normalizeParameterDataType('integer')).toBe('integer');
    expect(normalizeParameterDataType('signed')).toBe('integer');
  });

  it('preserves boolean and string', () => {
    expect(normalizeParameterDataType('boolean')).toBe('boolean');
    expect(normalizeParameterDataType('string')).toBe('string');
  });

  it('is case-insensitive and trims whitespace', () => {
    expect(normalizeParameterDataType('  POSITIVE ')).toBe('natural');
    expect(normalizeParameterDataType('Boolean')).toBe('boolean');
  });

  it('strips constrained subtype range/index clauses', () => {
    expect(normalizeParameterDataType('natural range 12 to 64')).toBe('natural');
    expect(normalizeParameterDataType('unsigned(7 downto 0)')).toBe('natural');
  });

  it('defaults unknown or empty types to integer', () => {
    expect(normalizeParameterDataType(undefined)).toBe('integer');
    expect(normalizeParameterDataType('')).toBe('integer');
    expect(normalizeParameterDataType('time')).toBe('integer');
  });
});
