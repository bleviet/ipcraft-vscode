import type { SystemGraph } from '../../../../domain/systemGraph';
import { analyzeClocks } from '../../../../webview/systemDiagram/clocks/analyzeClocks';
import {
  crossingCounts,
  crossingEndKeys,
  crossingsOfNet,
  crossingsWithin,
  levelClockSummary,
  nodeCrossings,
} from '../../../../webview/systemDiagram/clocks/crossingSummary';
import { endKey } from '../../../../webview/systemDiagram/clocks/physicalNets';
import { loadTwoClockGraph } from './clockTestGraphs';
import { loadClockFixtureGraph, loadFixtureGraph, loadQsysFixtureGraph } from './fixtureGraph';

const DSP = '/dsp_pipeline';

describe('crossingCounts', () => {
  const { crossings } = analyzeClocks(loadClockFixtureGraph());

  it('counts per status, all kinds or one', () => {
    expect(crossingCounts(crossings)).toEqual({ cross: 4, inside: 1, unchecked: 3, ok: 9 });
    expect(crossingCounts(crossings, 'data')).toEqual({ cross: 2, inside: 0, unchecked: 2, ok: 4 });
    expect(crossingCounts(crossings, 'reset')).toEqual({
      cross: 2,
      inside: 0,
      unchecked: 1,
      ok: 5,
    });
    expect(crossingCounts(crossings, 'block')).toEqual({
      cross: 0,
      inside: 1,
      unchecked: 0,
      ok: 0,
    });
    expect(crossingCounts([])).toEqual({ cross: 0, inside: 0, unchecked: 0, ok: 0 });
  });
});

describe('crossingsOfNet', () => {
  const { crossings } = analyzeClocks(loadClockFixtureGraph());

  it('finds the crossings that touch a net on any level of their tree', () => {
    const labels = (netId: string) =>
      crossingsOfNet(crossings, netId).map((x) => (x.kind === 'block' ? x.instance : x.to.label));
    expect(labels('/::dsp_pipeline_M_AXIS')).toEqual(['axi_dma_0/S_AXIS_S2MM']);
    expect(labels(`${DSP}::Conn2`)).toEqual(['axi_dma_0/S_AXIS_S2MM']);
    expect(labels(`${DSP}::aresetn_1`)).toEqual([
      'fir_compiler_0/aresetn',
      'ovf_monitor_0/rst_n',
      'axis_data_fifo_0/s_axis_aresetn',
      'fir_ctrl_0/rst_n',
      'ps7_0_axi_periph/aresetn',
      'axi_dma_0/axi_resetn',
    ]);
    expect(labels(`${DSP}::aclk_1`)).toEqual([]);
  });
});

describe('crossings per level and per node', () => {
  const graph = loadClockFixtureGraph();
  const { crossings } = analyzeClocks(graph);

  it('counts flagged crossings with an end on a level or nested below it', () => {
    expect(crossingsWithin(crossings, '/')).toEqual({ data: 2, reset: 2 });
    expect(crossingsWithin(crossings, DSP)).toEqual({ data: 2, reset: 2 });
    expect(crossingsWithin(crossings, `${DSP}/nested`)).toEqual({ data: 0, reset: 0 });
  });

  it('counts a data crossing at both ends but a reset crossing at its sink only', () => {
    expect(nodeCrossings(graph, crossings, `${DSP}/fir_compiler_0`)).toEqual({ data: 2, reset: 1 });
    expect(nodeCrossings(graph, crossings, `${DSP}/ovf_monitor_0`)).toEqual({ data: 0, reset: 1 });
    expect(nodeCrossings(graph, crossings, '/axi_dma_0')).toEqual({ data: 1, reset: 0 });
    expect(nodeCrossings(graph, crossings, '/rst_ps7_0_100M')).toEqual({ data: 0, reset: 0 });
    expect(nodeCrossings(graph, crossings, '/::ext_clk')).toEqual({ data: 0, reset: 0 });
  });

  it('counts everything inside a hierarchy block', () => {
    expect(nodeCrossings(graph, crossings, DSP)).toEqual({ data: 2, reset: 2 });
  });

  it('keys the pins to mark: both ends of a data crossing, the sink of a reset crossing', () => {
    const keys = crossingEndKeys(crossings);
    const key = (level: string, instance: string, pin: string) => endKey({ level, instance, pin });
    expect(keys.has(key(DSP, `${DSP}/fir_compiler_0`, 'M_AXIS_DATA'))).toBe(true);
    expect(keys.has(key('/', '/axi_dma_0', 'S_AXIS_S2MM'))).toBe(true);
    expect(keys.has(key(DSP, `${DSP}/fir_compiler_0`, 'aresetn'))).toBe(true);
    expect(keys.has(key('/', '/rst_ps7_0_100M', 'peripheral_aresetn'))).toBe(false);
    expect(keys.has(key(DSP, `${DSP}/axis_data_fifo_0`, 'S_AXIS'))).toBe(false);
    expect(keys.size).toBe(6);
  });
});

describe('levelClockSummary', () => {
  it('words the domains, crossings, spanning blocks and unchecked pins of a level', () => {
    const graph = loadClockFixtureGraph();
    const analysis = analyzeClocks(graph);
    expect(levelClockSummary(analysis, graph, DSP)).toBe(
      'This level: FCLK_CLK0 100 MHz, FCLK_CLK1 200 MHz. ' +
        '1 clock domain crossing without a synchronizer. ' +
        '2 resets released by another clock domain. ' +
        'axis_data_fifo_0 spans more than one domain. ' +
        '2 not checked: the clock of a pin is unknown offline.'
    );
  });

  it('counts the crossings inside nested hierarchies on the level above', () => {
    const graph = loadClockFixtureGraph();
    expect(levelClockSummary(analyzeClocks(graph), graph, '/')).toBe(
      'This level: ext_clk 125 MHz, FCLK_CLK0 100 MHz, FCLK_CLK1 200 MHz. ' +
        '1 clock domain crossing without a synchronizer. ' +
        '3 more inside nested hierarchies. ' +
        '1 not checked: the clock of a pin is unknown offline.'
    );
  });

  it('uses the singular and lists several spanning blocks', () => {
    const graph = loadClockFixtureGraph();
    graph.instances[`${DSP}/fir_ctrl_0`].pins.push({
      name: 'fast_clk',
      isInterface: false,
      direction: 'in',
      directionSource: 'declared',
      signalType: 'clk',
      parameters: {},
    });
    graph.nets
      .find((net) => net.id === `${DSP}::dsp_clk_1`)!
      .endpoints.push({ instance: `${DSP}/fir_ctrl_0`, pin: 'fast_clk' });
    const text = levelClockSummary(analyzeClocks(graph), graph, DSP);
    expect(text).toContain('axis_data_fifo_0, fir_ctrl_0 span more than one domain.');

    const two = loadTwoClockGraph();
    expect(levelClockSummary(analyzeClocks(two), two, '/')).toBe(
      'This level: ca/clk_out1 100 MHz, cb/clk_out1 50 MHz. ' +
        '1 clock domain crossing without a synchronizer. ' +
        '1 reset released by another clock domain.'
    );
  });

  it('says so when a level has no clock domain, and stays short when all is well', () => {
    const none: SystemGraph = { ...loadFixtureGraph(), nets: [] };
    expect(levelClockSummary(analyzeClocks(none), none, '/')).toBe('This level: no clock domains.');
    const nios = loadQsysFixtureGraph();
    expect(levelClockSummary(analyzeClocks(nios), nios, '/')).toBe('This level: clk 50 MHz.');
    const zynq = loadFixtureGraph();
    expect(levelClockSummary(analyzeClocks(zynq), zynq, '/')).toBe(
      'This level: FCLK_CLK0 100 MHz.'
    );
  });

  it('shows an unknown frequency as unknown and ignores an unknown level', () => {
    const graph = loadClockFixtureGraph();
    delete graph.instances['/processing_system7_0'].parameters[
      'CONFIG.PCW_FPGA0_PERIPHERAL_FREQMHZ'
    ];
    const analysis = analyzeClocks(graph);
    expect(levelClockSummary(analysis, graph, DSP)).toContain(
      'FCLK_CLK0 unknown, FCLK_CLK1 200 MHz'
    );
    expect(levelClockSummary(analysis, graph, '/nope')).toBe('This level: no clock domains.');
  });
});
