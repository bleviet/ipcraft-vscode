import { BUS_REGISTRY } from '../../../../generator/buses/builtin';

describe('BusRuleRegistry', () => {
  describe('normalize — VLNV strings', () => {
    it('resolves axi4_lite', () => {
      expect(BUS_REGISTRY.normalize('ipcraft.busif.axi4_lite.1.0')).toEqual({
        libraryKey: 'AXI4_LITE',
        templateType: 'axil',
      });
    });
    it('resolves axi4_full', () => {
      expect(BUS_REGISTRY.normalize('ipcraft.busif.axi4_full.1.0')).toEqual({
        libraryKey: 'AXI4_FULL',
        templateType: 'axi4',
      });
    });
    it('resolves axi_stream', () => {
      expect(BUS_REGISTRY.normalize('ipcraft.busif.axi_stream.1.0')).toEqual({
        libraryKey: 'AXI_STREAM',
        templateType: 'axis',
      });
    });
    it('resolves avalon_mm', () => {
      expect(BUS_REGISTRY.normalize('ipcraft.busif.avalon_mm.1.0')).toEqual({
        libraryKey: 'AVALON_MEMORY_MAPPED',
        templateType: 'avmm',
      });
    });
    it('resolves avalon_st', () => {
      expect(BUS_REGISTRY.normalize('ipcraft.busif.avalon_st.1.0')).toEqual({
        libraryKey: 'AVALON_STREAMING',
        templateType: 'avst',
      });
    });
    it('returns custom for unknown VLNV', () => {
      expect(BUS_REGISTRY.normalize('ipcraft.busif.unknown_bus.1.0')).toEqual({
        libraryKey: '',
        templateType: 'custom',
      });
    });
  });

  describe('normalize — aliases', () => {
    it.each([
      ['AXI4L', 'axil'],
      ['AXI4LITE', 'axil'],
      ['AXILITE', 'axil'],
      ['AXIL', 'axil'],
      ['AXI4', 'axi4'],
      ['AXI4FULL', 'axi4'],
      ['AVMM', 'avmm'],
      ['AVALONMM', 'avmm'],
      ['AXIS', 'axis'],
      ['AXI4S', 'axis'],
      ['AVST', 'avst'],
      ['AVALONST', 'avst'],
    ])('%s → templateType %s', (alias, expected) => {
      expect(BUS_REGISTRY.normalize(alias).templateType).toBe(expected);
    });

    it('returns custom for unknown alias', () => {
      expect(BUS_REGISTRY.normalize('UNKNOWN_BUS').templateType).toBe('custom');
    });
  });

  describe('isMemoryMapped', () => {
    it.each(['axil', 'axi4', 'avmm'])('%s is memory-mapped', (t) => {
      expect(BUS_REGISTRY.isMemoryMapped(t)).toBe(true);
    });
    it.each(['axis', 'avst', 'custom', 'conduit'])('%s is not memory-mapped', (t) => {
      expect(BUS_REGISTRY.isMemoryMapped(t)).toBe(false);
    });
  });
});
