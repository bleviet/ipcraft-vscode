import { displayDirection } from '../../../webview/shared/utils/formatters';

describe('displayDirection', () => {
  it('maps short names to display names', () => {
    expect(displayDirection('in')).toBe('input');
    expect(displayDirection('out')).toBe('output');
    expect(displayDirection('inout')).toBe('inout');
  });

  it('passes through already-long names', () => {
    expect(displayDirection('input')).toBe('input');
    expect(displayDirection('output')).toBe('output');
  });

  it('is case-insensitive', () => {
    expect(displayDirection('IN')).toBe('input');
    expect(displayDirection('Out')).toBe('output');
    expect(displayDirection('INOUT')).toBe('inout');
  });

  it('returns the original string for unknown directions', () => {
    expect(displayDirection('buffer')).toBe('buffer');
  });

  it('uses fallback for undefined', () => {
    expect(displayDirection(undefined)).toBe('input');
    expect(displayDirection(undefined, 'output')).toBe('output');
  });

  it('returns empty string as-is (fallback only applies to undefined)', () => {
    expect(displayDirection('')).toBe('');
  });
});
