import type { AddressSegment, SystemInstance } from '../../../../domain/systemGraph';
import {
  boundaryId,
  breadcrumbs,
  instanceTypeLabel,
  isClockOrReset,
  levelOf,
  matchesQuery,
  netsByEndpoint,
  netDriver,
  parseBoundaryId,
  pinTooltip,
  pinRole,
  reconcileNavigation,
  resolvePin,
  segmentHigh,
  segmentRangeText,
  selectionLevel,
  shortVlnv,
  visibleNets,
} from '../../../../webview/systemDiagram/model';
import { loadFixtureGraph, loadQsysFixtureGraph } from './fixtureGraph';

const graph = loadFixtureGraph();

describe('system diagram model', () => {
  it('computes levels and breadcrumbs', () => {
    expect(levelOf('/axi_dma_0')).toBe('/');
    expect(levelOf('/dsp_pipeline/coeff_bank')).toBe('/dsp_pipeline');
    expect(breadcrumbs('/', 'design')).toEqual([{ path: '/', label: 'design' }]);
    expect(breadcrumbs('/dsp_pipeline/coeff_bank', 'design')).toEqual([
      { path: '/', label: 'design' },
      { path: '/dsp_pipeline', label: 'dsp_pipeline' },
      { path: '/dsp_pipeline/coeff_bank', label: 'coeff_bank' },
    ]);
  });

  it('round-trips boundary ids', () => {
    expect(parseBoundaryId(boundaryId('/dsp_pipeline', 'aclk'))).toEqual({
      level: '/dsp_pipeline',
      pin: 'aclk',
    });
  });

  it('reverses roles for boundary pins', () => {
    const input = graph.levels['/'].boundaryPins.find((pin) => pin.name === 'ext_trigger');
    expect(input?.direction).toBe('in');
    expect(pinRole(input!, true)).toBe('source');
    expect(pinRole(input!, false)).toBe('sink');
  });

  it('picks the source endpoint as the net driver', () => {
    const net = graph.nets.find((candidate) => candidate.id === '/::axi_dma_0_M_AXIS_MM2S');
    expect(net).toBeDefined();
    expect(netDriver(graph, net!)).toEqual({ instance: '/axi_dma_0', pin: 'M_AXIS_MM2S' });
    const pin = resolvePin(graph, '/', { instance: null, pin: 'ext_trigger' });
    expect(pin?.name).toBe('ext_trigger');
  });

  it('falls back to the first endpoint when no endpoint is a source', () => {
    const net = {
      ...graph.nets[0],
      endpoints: [{ instance: '/nope', pin: 'x' }],
    };
    expect(netDriver(graph, net)).toEqual({ instance: '/nope', pin: 'x' });
  });

  it('matches instances by name or VLNV, case-insensitively', () => {
    const dma = graph.instances['/axi_dma_0'];
    expect(matchesQuery(dma, '')).toBe(true);
    expect(matchesQuery(dma, 'AXI_DMA')).toBe(true);
    expect(matchesQuery(dma, 'xilinx.com:ip:axi_dma')).toBe(true);
    expect(matchesQuery(dma, 'gpio')).toBe(false);
  });

  it('filters clock and reset nets', () => {
    const clock = graph.nets.find((net) => net.name === 'processing_system7_0_FCLK_CLK0');
    expect(isClockOrReset(clock!)).toBe(true);
    const all = visibleNets(graph, '/', true);
    const hidden = visibleNets(graph, '/', false);
    expect(all).toHaveLength(20);
    expect(hidden.length).toBeLessThan(all.length);
    expect(hidden.some(isClockOrReset)).toBe(false);
  });

  it('maps endpoints to nets and selections to levels', () => {
    const lookup = netsByEndpoint(graph, '/');
    expect(lookup.get('/axi_dma_0::M_AXIS_MM2S')?.map((net) => net.name)).toEqual([
      'axi_dma_0_M_AXIS_MM2S',
    ]);
    expect(selectionLevel(graph, { kind: 'instance', id: '/dsp_pipeline/coeff_bank' })).toBe(
      '/dsp_pipeline'
    );
    expect(selectionLevel(graph, { kind: 'boundary', id: boundaryId('/', 'DDR') })).toBe('/');
    expect(selectionLevel(graph, { kind: 'net', id: '/dsp_pipeline::aclk_1' })).toBe(
      '/dsp_pipeline'
    );
  });

  it('lists every net of a pin that sits on several nets, in graph order', () => {
    const lookup = netsByEndpoint(loadQsysFixtureGraph(), '/');
    const names = (key: string) => lookup.get(key)?.map((net) => net.name);
    expect(names('/jtag_uart_0::reset')).toEqual([
      'clk_0.clk_reset',
      'nios2_gen2_0.debug_reset_request',
    ]);
    expect(names('/pio_0::reset')).toEqual(['clk_0.clk_reset', 'nios2_gen2_0.debug_reset_request']);
    expect(names('/onchip_memory2_0::s1')).toEqual([
      'nios2_gen2_0.data_master',
      'nios2_gen2_0.instruction_master',
    ]);
    expect(names('/clk_0::clk_in')).toEqual(['clk']);
    expect(names('::clk')).toEqual(['clk']);
  });

  it('words the pin tooltip with every net and the definition', () => {
    const pin = { name: 's1', direction: 'slave' as const, directionSource: 'connection' as const };
    expect(pinTooltip(pin, ['a', 'b'])).toBe('s1 · a, b · slave from connection');
    expect(pinTooltip(pin, [])).toBe('s1 · unconnected · slave from connection');
    expect(pinTooltip({ ...pin, definedBy: 'hdl' }, ['a'])).toBe(
      's1 · a · slave from connection · hdl'
    );
  });

  it('formats the address range: unknown for qsys, auto otherwise', () => {
    const segment = (range?: string): AddressSegment => ({
      addressSpace: 'a',
      segment: 'b',
      masterInstance: '/a',
      slaveInstance: '/b',
      range,
      line: 1,
    });
    expect(segmentRangeText(segment('0x1000'), 'qsys')).toBe('0x1000');
    expect(segmentRangeText(segment(), 'qsys')).toBe('-');
    expect(segmentRangeText(segment(), 'qsys-tcl')).toBe('-');
    expect(segmentRangeText(segment('0x1000'), 'qsys-tcl')).toBe('0x1000');
    expect(segmentRangeText(segment(), 'vivado-bd-tcl')).toBe('auto');
    expect(segmentRangeText(segment('0x1000'), 'vivado-bd-tcl')).toBe('0x1000');
  });

  it('shortens VLNVs', () => {
    expect(shortVlnv('xilinx.com:ip:axi_dma:7.1')).toBe('axi_dma:7.1');
  });

  it('labels instance types for the outline and the node header', () => {
    const base = { path: '/x', name: 'x', parent: '/', parameters: {}, pins: [], line: 1 };
    const label = (extra: Partial<SystemInstance>) =>
      instanceTypeLabel({ ...base, kind: 'ip', ...extra });
    expect(label({ vlnv: 'xilinx.com:ip:axi_dma:7.1' })).toBe('axi_dma:7.1');
    expect(label({ kind: 'module', moduleRef: 'fir_filter' })).toBe('fir_filter');
    expect(label({ kind: 'module' })).toBeUndefined();
    expect(label({ kind: 'hier' })).toBeUndefined();
    expect(label({ component: 'altera_nios2_gen2', version: '18.1' })).toBe(
      'altera_nios2_gen2 18.1'
    );
    expect(label({ component: 'altera_nios2_gen2' })).toBe('altera_nios2_gen2');
  });

  it('matches qsys instances by component and version', () => {
    const instance = loadQsysFixtureGraph().instances['/nios2_gen2_0'];
    expect(matchesQuery(instance, 'nios2_gen2')).toBe(true);
    expect(matchesQuery(instance, 'altera_nios2')).toBe(true);
    expect(matchesQuery(instance, '18.1')).toBe(true);
    expect(matchesQuery(instance, 'zynq')).toBe(false);
  });

  it('computes the high address only for hex offset and range', () => {
    const segment = (offset?: string, range?: string): AddressSegment => ({
      addressSpace: 's',
      segment: 'g',
      masterInstance: '/m',
      slaveInstance: '/s',
      offset,
      range,
      line: 1,
    });
    expect(segmentHigh(segment('0x40400000', '0x00010000'))).toBe('0x4040FFFF');
    expect(segmentHigh(segment('0x100000000', '0x1000'))).toBe('0x100000FFF');
    expect(segmentHigh(segment(undefined, '0x1000'))).toBeUndefined();
    expect(segmentHigh(segment('0x0', '64K'))).toBeUndefined();
    expect(segmentHigh(segment('0x0', '0x0'))).toBeUndefined();
  });

  describe('reconcileNavigation', () => {
    const inst = { kind: 'instance', id: '/axi_dma_0' } as const;

    it('returns valid input unchanged', () => {
      const result = reconcileNavigation(graph, '/dsp_pipeline', {
        kind: 'instance',
        id: '/dsp_pipeline/fir_compiler_0',
      });
      expect(result.levelPath).toBe('/dsp_pipeline');
      expect(result.selection).toEqual({ kind: 'instance', id: '/dsp_pipeline/fir_compiler_0' });
      const same = reconcileNavigation(graph, '/', inst);
      expect(same.selection).toBe(inst);
    });

    it('goes to the root and drops the selection when the level vanished', () => {
      expect(reconcileNavigation(graph, '/gone', inst)).toEqual({
        levelPath: '/',
        selection: null,
      });
    });

    it('clears selections that no longer exist', () => {
      expect(
        reconcileNavigation(graph, '/', { kind: 'instance', id: '/gone' }).selection
      ).toBeNull();
      expect(
        reconcileNavigation(graph, '/', { kind: 'boundary', id: boundaryId('/', 'nope') }).selection
      ).toBeNull();
      expect(reconcileNavigation(graph, '/', { kind: 'net', id: '/::nope' }).selection).toBeNull();
    });

    it('keeps existing boundary and net selections', () => {
      const boundary = { kind: 'boundary', id: boundaryId('/', 'DDR') } as const;
      const net = { kind: 'net', id: graph.nets[0].id } as const;
      expect(reconcileNavigation(graph, '/', boundary).selection).toBe(boundary);
      expect(reconcileNavigation(graph, '/', net).selection).toBe(net);
    });
  });
});
