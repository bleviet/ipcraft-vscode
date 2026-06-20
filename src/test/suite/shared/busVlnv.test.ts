import { busSupportsMemoryMap, BUS_VLNV } from '../../../shared/busVlnv';

describe('busSupportsMemoryMap', () => {
  describe('Avalon-MM (memory-mapped)', () => {
    it('accepts the IPCraft Avalon-MM VLNV in slave mode', () => {
      expect(busSupportsMemoryMap(BUS_VLNV.AVALON_MM, 'slave')).toBe(true);
    });

    it('accepts the Vivado-emitted "xilinx.com:interface:avalon:1.0" VLNV (issue #8)', () => {
      expect(busSupportsMemoryMap('xilinx.com:interface:avalon:1.0', 'slave')).toBe(true);
    });

    it('accepts hyphenated "avalon-mm" spelling', () => {
      expect(busSupportsMemoryMap('xilinx.com:interface:avalon-mm:1.0', 'slave')).toBe(true);
    });

    it('matches case-insensitively', () => {
      expect(busSupportsMemoryMap('AVALON_MM', 'slave')).toBe(true);
    });
  });

  describe('AXI4 (memory-mapped)', () => {
    it('accepts AXI4-Lite slave', () => {
      expect(busSupportsMemoryMap(BUS_VLNV.AXI4_LITE, 'slave')).toBe(true);
    });

    it('accepts AXI4-Full slave', () => {
      expect(busSupportsMemoryMap(BUS_VLNV.AXI4_FULL, 'slave')).toBe(true);
    });
  });

  describe('streaming protocols (never memory-mapped)', () => {
    it('rejects Avalon-ST even though it contains "avalon"', () => {
      expect(busSupportsMemoryMap(BUS_VLNV.AVALON_ST, 'slave')).toBe(false);
    });

    it('rejects hyphenated "avalon-st" spelling', () => {
      expect(busSupportsMemoryMap('xilinx.com:interface:avalon-st:1.0', 'slave')).toBe(false);
    });

    it('rejects AXI-Stream slave', () => {
      expect(busSupportsMemoryMap(BUS_VLNV.AXI_STREAM, 'slave')).toBe(false);
    });

    it('rejects an Altera streaming VLNV', () => {
      expect(busSupportsMemoryMap('altera.com:interface:avalon_streaming:19.1', 'slave')).toBe(
        false
      );
    });
  });

  describe('non-slave modes', () => {
    it('rejects a master Avalon-MM interface', () => {
      expect(busSupportsMemoryMap(BUS_VLNV.AVALON_MM, 'master')).toBe(false);
    });

    it('rejects the Vivado Avalon VLNV in master mode', () => {
      expect(busSupportsMemoryMap('xilinx.com:interface:avalon:1.0', 'master')).toBe(false);
    });
  });

  describe('other / unsupported types', () => {
    it('rejects a conduit interface', () => {
      expect(busSupportsMemoryMap(BUS_VLNV.CONDUIT, 'slave')).toBe(false);
    });

    it('rejects an unknown custom interface', () => {
      expect(busSupportsMemoryMap('user:busif:xcvr:1.0', 'slave')).toBe(false);
    });

    it('rejects an empty type string', () => {
      expect(busSupportsMemoryMap('', 'slave')).toBe(false);
    });
  });
});
