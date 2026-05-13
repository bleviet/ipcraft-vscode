import { parseVlnv, formatVlnv, isValidVlnv } from '../../../utils/vlnv';

describe('vlnv utilities', () => {
  describe('parseVlnv', () => {
    it('parses a fully-qualified VLNV string', () => {
      const result = parseVlnv('xilinx.com:ip:fifo_generator:13.2');
      expect(result).toEqual({
        vendor: 'xilinx.com',
        library: 'ip',
        name: 'fifo_generator',
        version: '13.2',
      });
    });

    it('throws for a string with fewer than 4 parts', () => {
      expect(() => parseVlnv('xilinx.com:ip:fifo_generator')).toThrow();
    });

    it('throws for an empty string', () => {
      expect(() => parseVlnv('')).toThrow();
    });

    it('throws for a non-colon-separated string', () => {
      expect(() => parseVlnv('just-a-name')).toThrow();
    });

    it('handles version with dots and dashes', () => {
      const result = parseVlnv('acme.com:user:my_ip:1.0-beta');
      expect(result.version).toBe('1.0-beta');
    });
  });

  describe('formatVlnv', () => {
    it('formats a VLNV object to colon-separated string', () => {
      const result = formatVlnv({
        vendor: 'xilinx.com',
        library: 'ip',
        name: 'fifo_generator',
        version: '13.2',
      });
      expect(result).toBe('xilinx.com:ip:fifo_generator:13.2');
    });
  });

  describe('isValidVlnv', () => {
    it('returns true for a valid VLNV string', () => {
      expect(isValidVlnv('xilinx.com:ip:fifo_generator:13.2')).toBe(true);
    });

    it('returns false for a string missing parts', () => {
      expect(isValidVlnv('xilinx.com:ip:fifo_generator')).toBe(false);
    });

    it('returns false for an empty string', () => {
      expect(isValidVlnv('')).toBe(false);
    });

    it('returns false for null/undefined', () => {
      expect(isValidVlnv(null as unknown as string)).toBe(false);
      expect(isValidVlnv(undefined as unknown as string)).toBe(false);
    });

    it('returns true for a minimal valid VLNV', () => {
      expect(isValidVlnv('a:b:c:1.0')).toBe(true);
    });
  });
});
