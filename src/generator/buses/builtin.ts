import { BusRuleRegistry } from './registry';

export const BUS_REGISTRY = new BusRuleRegistry()
  .register({
    id: 'axil',
    vlnvNames: ['axi4_lite'],
    aliases: ['AXI4L', 'AXI4LITE', 'AXILITE', 'AXIL'],
    libraryKey: 'AXI4_LITE',
    isMemoryMapped: true,
  })
  .register({
    id: 'axi4',
    vlnvNames: ['axi4_full'],
    aliases: ['AXI4F', 'AXI4FULL', 'AXI4'],
    libraryKey: 'AXI4_FULL',
    isMemoryMapped: true,
  })
  .register({
    id: 'avmm',
    vlnvNames: ['avalon_mm'],
    aliases: ['AVALONMM', 'AVMM', 'AVALONMEMORYMAPPED'],
    libraryKey: 'AVALON_MEMORY_MAPPED',
    isMemoryMapped: true,
  })
  .register({
    id: 'axis',
    vlnvNames: ['axi_stream'],
    aliases: ['AXI4S', 'AXISTREAM', 'AXIS'],
    libraryKey: 'AXI_STREAM',
    isMemoryMapped: false,
  })
  .register({
    id: 'avst',
    vlnvNames: ['avalon_st'],
    aliases: ['AVALONSTREAMING', 'AVALONST', 'AVST'],
    libraryKey: 'AVALON_STREAMING',
    isMemoryMapped: false,
  });
