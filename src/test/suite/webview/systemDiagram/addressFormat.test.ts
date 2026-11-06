import { formatRange, groupHex } from '../../../../webview/systemDiagram/addressFormat';

describe('groupHex', () => {
  it('groups upper-cased digits in fours, padding the leading group', () => {
    expect(groupHex('0x40400000')).toBe('0x4040_0000');
    expect(groupHex('0x00011000')).toBe('0x0001_1000');
    expect(groupHex('0x1000')).toBe('0x1000');
    expect(groupHex('0x800')).toBe('0x0800');
    expect(groupHex('0xabcde')).toBe('0x000A_BCDE');
    expect(groupHex('0x0')).toBe('0x0000');
  });

  it('leaves non-hex text alone', () => {
    expect(groupHex('auto')).toBe('auto');
    expect(groupHex('-')).toBe('-');
    expect(groupHex('64K')).toBe('64K');
  });
});

describe('formatRange', () => {
  it('humanizes exact power-of-1024 multiples', () => {
    expect(formatRange('0x10000')).toBe('64K');
    expect(formatRange('0x1000')).toBe('4K');
    expect(formatRange('0x20000000')).toBe('512M');
    expect(formatRange('0x40000000')).toBe('1G');
    expect(formatRange('0x100000')).toBe('1M');
    expect(formatRange('0x60000')).toBe('384K');
  });

  it('groups hex that is not a multiple of 1 KiB', () => {
    expect(formatRange('0x200')).toBe('0x0200');
    expect(formatRange('0x10001')).toBe('0x0001_0001');
    expect(formatRange('0x0')).toBe('0x0000');
  });

  it('passes non-hex text through', () => {
    expect(formatRange('auto')).toBe('auto');
    expect(formatRange('-')).toBe('-');
    expect(formatRange('64K')).toBe('64K');
  });
});
