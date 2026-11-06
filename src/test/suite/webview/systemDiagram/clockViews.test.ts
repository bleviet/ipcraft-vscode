import { analyzeClocks } from '../../../../webview/systemDiagram/clocks/analyzeClocks';
import { DOMAIN_COLORS } from '../../../../webview/systemDiagram/clocks/clockDomains';
import { crossingEndKeys } from '../../../../webview/systemDiagram/clocks/crossingSummary';
import { UNRELEASED_RESET_COLOR } from '../../../../webview/systemDiagram/clocks/domainView';
import { edgeMarks } from '../../../../webview/systemDiagram/clocks/edgeView';
import { nodePinMarks } from '../../../../webview/systemDiagram/clocks/nodeView';
import { selectedTree } from '../../../../webview/systemDiagram/clocks/treeSelection';
import { loadClockFixtureGraph } from './fixtureGraph';

const DSP = '/dsp_pipeline';
const CLK0 = '/::processing_system7_0_FCLK_CLK0';
const CLK1 = '/::processing_system7_0_FCLK_CLK1';
const RESET_NET = '/::rst_ps7_0_100M_peripheral_aresetn';
const PS_RESET_NET = '/::processing_system7_0_FCLK_RESET0_N';
const DATA_NET = '/::axi_dma_0_M_AXIS_MM2S';

const graph = loadClockFixtureGraph();
const analysis = analyzeClocks(graph);
const net = (id: string) => ({ kind: 'net' as const, id });

describe('selectedTree', () => {
  it('takes the whole clock domain of a clock net, on every level', () => {
    const tree = selectedTree(analysis, net(`${DSP}::aclk_1`));
    expect(tree?.kind).toBe('clock');
    expect([...(tree?.netIds ?? [])].sort()).toEqual([`${DSP}::aclk_1`, CLK0].sort());
  });

  it('takes the whole reset tree of a reset net', () => {
    const tree = selectedTree(analysis, net(`${DSP}::aresetn_1`));
    expect(tree?.kind).toBe('reset');
    expect(tree?.netIds.has(RESET_NET)).toBe(true);
  });

  it('is undefined for a data net, an instance, or no selection', () => {
    expect(selectedTree(analysis, net(DATA_NET))).toBeUndefined();
    expect(selectedTree(analysis, { kind: 'instance', id: '/axi_dma_0' })).toBeUndefined();
    expect(selectedTree(analysis, null)).toBeUndefined();
  });
});

describe('edgeMarks', () => {
  const edge = (
    netId: string,
    category: 'clock' | 'reset' | 'aximm' | 'axis',
    id = `${netId}#0`
  ) => ({
    id,
    data: { netId, category },
  });
  const base = { analysis, tree: undefined, crossingEdgeIds: new Set<string>() };

  it('marks nothing outside the domain mode without a selected tree', () => {
    expect(edgeMarks({ ...base, domainMode: false }, edge(CLK0, 'clock'))).toEqual({});
    expect(edgeMarks({ ...base, domainMode: false }, edge(DATA_NET, 'axis'))).toEqual({});
  });

  it('colors a clock wire with its domain in the domain mode', () => {
    expect(edgeMarks({ ...base, domainMode: true }, edge(CLK1, 'clock'))).toEqual({
      domainColor: DOMAIN_COLORS[2],
    });
  });

  it('dots a reset wire in the color of the releasing domain, muted when asynchronous', () => {
    expect(edgeMarks({ ...base, domainMode: true }, edge(RESET_NET, 'reset'))).toEqual({
      domainColor: DOMAIN_COLORS[1],
      dotted: true,
    });
    expect(edgeMarks({ ...base, domainMode: true }, edge(PS_RESET_NET, 'reset'))).toEqual({
      domainColor: UNRELEASED_RESET_COLOR,
      dotted: true,
    });
  });

  it('dims every other wire in the domain mode', () => {
    expect(edgeMarks({ ...base, domainMode: true }, edge(DATA_NET, 'axis'))).toEqual({
      dimmed: true,
    });
  });

  it('draws a crossing wire as a crossing, whatever its category', () => {
    const marks = edgeMarks(
      { ...base, domainMode: true, crossingEdgeIds: new Set(['x#1']) },
      edge(DATA_NET, 'axis', 'x#1')
    );
    expect(marks).toEqual({ crossing: true });
    const outside = edgeMarks(
      { ...base, domainMode: false, crossingEdgeIds: new Set(['x#1']) },
      edge(DATA_NET, 'axis', 'x#1')
    );
    expect(outside).toEqual({});
  });

  it('colors the wires of a selected clock tree even outside the domain mode', () => {
    const tree = selectedTree(analysis, net(CLK1));
    const context = { ...base, domainMode: false, tree };
    expect(edgeMarks(context, edge(CLK1, 'clock'))).toEqual({ domainColor: DOMAIN_COLORS[2] });
    expect(edgeMarks(context, edge(CLK0, 'clock'))).toEqual({});
  });
});

describe('nodePinMarks', () => {
  const crossingKeys = crossingEndKeys(analysis.crossings);
  const context = { graph, analysis, crossingKeys, tree: undefined };

  it('marks nothing without the domain mode or a selected tree', () => {
    expect(nodePinMarks({ ...context, domainMode: false }, '/axi_dma_0')).toBeUndefined();
  });

  it('colors a clock pin with its domain and labels it with the frequency', () => {
    const marks = nodePinMarks({ ...context, domainMode: true }, '/axi_dma_0');
    expect(marks?.s_axi_lite_aclk).toEqual({ color: DOMAIN_COLORS[1], frequency: '100 MHz' });
  });

  it('colors a reset pin with the releasing domain and no label', () => {
    const marks = nodePinMarks({ ...context, domainMode: true }, '/axi_dma_0');
    expect(marks?.axi_resetn).toEqual({ color: DOMAIN_COLORS[1] });
  });

  it('marks the ends of a crossing', () => {
    const dma = nodePinMarks({ ...context, domainMode: true }, '/axi_dma_0');
    expect(dma?.S_AXIS_S2MM).toEqual({ crossing: true });
    expect(dma?.M_AXIS_MM2S).toBeUndefined();
    const fir = nodePinMarks({ ...context, domainMode: true }, `${DSP}/fir_compiler_0`);
    expect(fir?.M_AXIS_DATA).toEqual({ crossing: true });
    expect(fir?.aresetn).toEqual({ color: DOMAIN_COLORS[1], crossing: true });
  });

  it('marks the pins of a hierarchy block and of a port', () => {
    const hier = nodePinMarks({ ...context, domainMode: true }, DSP);
    expect(hier?.dsp_clk).toEqual({ color: DOMAIN_COLORS[2], frequency: '200 MHz' });
    const port = nodePinMarks({ ...context, domainMode: true }, '/::ext_clk');
    expect(port?.ext_clk).toEqual({ color: DOMAIN_COLORS[0], frequency: '125 MHz' });
  });

  it('shows only the selected domain outside the domain mode', () => {
    const tree = selectedTree(analysis, net(CLK1));
    const outside = { ...context, domainMode: false, tree };
    expect(nodePinMarks(outside, `${DSP}/fir_compiler_0`)?.aclk).toEqual({
      color: DOMAIN_COLORS[2],
      frequency: '200 MHz',
    });
    expect(nodePinMarks(outside, '/axi_dma_0')).toBeUndefined();
    expect(nodePinMarks(outside, `${DSP}/fir_compiler_0`)?.aresetn).toBeUndefined();
  });

  it('knows nothing of a node that is not in the graph', () => {
    expect(nodePinMarks({ ...context, domainMode: true }, '/nothing')).toBeUndefined();
  });
});
