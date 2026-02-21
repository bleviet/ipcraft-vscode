import { toHex } from '../../../webview/utils/formatUtils';

describe('formatUtils', () => {
  it('formats positive numbers as uppercase hex with prefix', () => {
    expect(toHex(0)).toBe('0x0');
    expect(toHex(255)).toBe('0xFF');
    expect(toHex(4096)).toBe('0x1000');
  });

  it('clamps negative values to zero', () => {
    expect(toHex(-1)).toBe('0x0');
    expect(toHex(-255)).toBe('0x0');
  });
});
