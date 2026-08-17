import { BusRuleRegistry } from './registry';
import { BUS_VLNV } from '../../shared/busVlnv';

export const BUS_REGISTRY = new BusRuleRegistry()
  .register({
    id: 'axil',
    canonicalVlnv: BUS_VLNV.AXI4_LITE,
    libraryKey: 'AXI4_LITE',
  })
  .register({
    id: 'axi4',
    canonicalVlnv: BUS_VLNV.AXI4_FULL,
    libraryKey: 'AXI4_FULL',
  })
  .register({
    id: 'avmm',
    canonicalVlnv: BUS_VLNV.AVALON_MM,
    libraryKey: 'AVALON_MEMORY_MAPPED',
  })
  .register({
    id: 'axis',
    canonicalVlnv: BUS_VLNV.AXI_STREAM,
    libraryKey: 'AXI_STREAM',
  })
  .register({
    id: 'avst',
    canonicalVlnv: BUS_VLNV.AVALON_ST,
    libraryKey: 'AVALON_STREAMING',
  });
