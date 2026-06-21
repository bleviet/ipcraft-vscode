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
    expect(calculateBlockSize({ size: '4K' } as unknown as CalculateBlockSizeParam)).toBe(4096);
    expect(calculateBlockSize({ size: '1M' } as unknown as CalculateBlockSizeParam)).toBe(
      1024 * 1024
    );
    expect(calculateBlockSize({ range: '2G' } as unknown as CalculateBlockSizeParam)).toBe(
      2 * 1024 * 1024 * 1024
    );
    expect(calculateBlockSize({ size: '1.5K' } as unknown as CalculateBlockSizeParam)).toBe(1536);
    expect(calculateBlockSize({ size: ' 8 k ' } as unknown as CalculateBlockSizeParam)).toBe(8192);
  });

  it('correctly parses hex and standard numeric sizes', () => {
    expect(calculateBlockSize({ size: 256 } as unknown as CalculateBlockSizeParam)).toBe(256);
    expect(calculateBlockSize({ size: '0x1000' } as unknown as CalculateBlockSizeParam)).toBe(4096);
    expect(calculateBlockSize({ range: '0x20' } as unknown as CalculateBlockSizeParam)).toBe(32);
  });

  it('falls back to 4 if size is unparseable', () => {
    expect(calculateBlockSize({ size: 'invalid' } as unknown as CalculateBlockSizeParam)).toBe(4);
    expect(calculateBlockSize({} as unknown as CalculateBlockSizeParam)).toBe(4);
  });
});
