import { analyzeClocks } from '../../../../webview/systemDiagram/clocks/analyzeClocks';
import {
  crossingCounts,
  crossingEndKeys,
  crossingsOfNet,
  crossingsWithin,
  nodeCrossings,
} from '../../../../webview/systemDiagram/clocks/crossingSummary';
import { endKey } from '../../../../webview/systemDiagram/clocks/physicalNets';
import { loadClockFixtureGraph } from './fixtureGraph';

const DSP = '/dsp_pipeline';

describe('crossingCounts', () => {
  const { crossings } = analyzeClocks(loadClockFixtureGraph());

  it('counts per status, all kinds or one', () => {
    expect(crossingCounts(crossings)).toEqual({
      cross: 4,
      related: 0,
      inside: 1,
      unchecked: 3,
      ok: 9,
    });
    expect(crossingCounts(crossings, 'data')).toEqual({
      cross: 2,
      related: 0,
      inside: 0,
      unchecked: 2,
      ok: 4,
    });
    expect(crossingCounts(crossings, 'reset')).toEqual({
      cross: 2,
      related: 0,
      inside: 0,
      unchecked: 1,
      ok: 5,
    });
    expect(crossingCounts(crossings, 'block')).toEqual({
      cross: 0,
      related: 0,
      inside: 1,
      unchecked: 0,
      ok: 0,
    });
    expect(crossingCounts([])).toEqual({ cross: 0, related: 0, inside: 0, unchecked: 0, ok: 0 });
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
