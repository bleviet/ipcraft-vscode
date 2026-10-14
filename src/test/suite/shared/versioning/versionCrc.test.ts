import { crc16, crc8, utf8Bytes } from '../../../../shared/versioning/versionCrc';
import { versionBytes } from '../../../../shared/versioning/versionScheme';

const CHECK = Array.from('123456789', (char) => char.charCodeAt(0));

describe('crc8 (CRC-8/I-432-1)', () => {
  it('matches the catalogue check value', () => {
    expect(crc8(CHECK)).toBe(0xa1);
  });

  it('never gives 0 for the all-zero version', () => {
    expect(crc8([0, 0])).toBe(0x55);
    expect(crc8([0, 0, 0])).toBe(0x55);
    expect(crc8([0, 0, 0, 0])).toBe(0x55);
  });

  it('covers the version 1.4.2 bytes', () => {
    expect(crc8([1, 4, 2])).toBe(0x64);
  });
});

describe('crc16 (CRC-16/IBM-3740)', () => {
  it('matches the catalogue check value', () => {
    expect(crc16(CHECK)).toBe(0x29b1);
  });

  it('never gives 0 for the all-zero version', () => {
    expect(crc16([0, 0])).toBe(0x1d0f);
    expect(crc16([0, 0, 0])).toBe(0xcc9c);
    expect(crc16([0, 0, 0, 0])).toBe(0x84c0);
  });

  it('covers the version 1.4.2 bytes', () => {
    expect(crc16([1, 4, 2])).toBe(0x172a);
  });
});

describe('utf8Bytes', () => {
  it.each(['a', 'é', 'β', '€', '\u{1F600}', 'Café-β1'])('agrees with Buffer for %s', (text) => {
    expect(utf8Bytes(text)).toEqual(Array.from(Buffer.from(text, 'utf8')));
  });
});

describe('version CRCs over a free-text version', () => {
  it('uses the UTF-8 bytes of the trimmed text', () => {
    const bytes = versionBytes('free', '  Café-β1 ') as number[];
    expect(bytes).toEqual([67, 97, 102, 195, 169, 45, 206, 178, 49]);
    expect(crc8(bytes)).toBe(0x47);
    expect(crc16(bytes)).toBe(0x2d50);
  });
});
