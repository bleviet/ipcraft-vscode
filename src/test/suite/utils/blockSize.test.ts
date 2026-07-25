import { calculateBlockSize } from '../../../webview/utils/blockSize';

type CalculateBlockSizeParam = Parameters<typeof calculateBlockSize>[0];

describe('calculateBlockSize', () => {
  it('correctly calculates size of register blocks based on registers footprint', () => {
    const block = {
      registers: [
        { offset: 0, size: 32 },
        { offset: 4, size: 32 },
        { offset: 8, __kind: 'array', count: 4, stride: 8 }, // footprint: 32 bytes
      ],
    };
    expect(calculateBlockSize(block as unknown as CalculateBlockSizeParam)).toBe(40);
  });

  it('correctly parses sizes with K, M, G suffixes for memory regions', () => {
    expect(calculateBlockSize({ size: '4K' })).toBe(4096);
    expect(calculateBlockSize({ size: '1M' })).toBe(1024 * 1024);
    expect(calculateBlockSize({ range: '2G' })).toBe(2 * 1024 * 1024 * 1024);
    expect(calculateBlockSize({ size: '1.5K' })).toBe(1536);
    expect(calculateBlockSize({ size: ' 8 k ' })).toBe(8192);
  });

  it('correctly parses hex and standard numeric sizes', () => {
    expect(calculateBlockSize({ size: 256 })).toBe(256);
    expect(calculateBlockSize({ size: '0x1000' })).toBe(4096);
    expect(calculateBlockSize({ range: '0x20' })).toBe(32);
  });

  it('falls back to 4 if size is unparseable', () => {
    expect(calculateBlockSize({ size: 'invalid' })).toBe(4);
    expect(calculateBlockSize({})).toBe(4);
  });
});
