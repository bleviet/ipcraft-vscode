import { analyzeClocks } from '../../../../webview/systemDiagram/clocks/analyzeClocks';
import { DOMAIN_COLORS } from '../../../../webview/systemDiagram/clocks/clockDomains';
import { clockDecor } from '../../../../webview/systemDiagram/clockDecor';
import { highlightedPinsByNode } from '../../../../webview/systemDiagram/pinHighlight';
import { buildElkInput, toFlowElements } from '../../../../webview/systemDiagram/layout/elkLayout';
import { runElkLayout } from '../../../../webview/systemDiagram/layout/runElkLayout';
import { loadClockFixtureGraph, fakeMeasure } from './fixtureGraph';

const DSP = '/dsp_pipeline';
const graph = loadClockFixtureGraph();
const analysis = analyzeClocks(graph);

async function layoutOf(levelPath: string, expanded: readonly string[] = []) {
  const laidOut = await runElkLayout(
    buildElkInput(graph, levelPath, {
      measure: fakeMeasure,
      expanded: new Set(expanded),
    })
  );
  return toFlowElements(laidOut, graph, levelPath, fakeMeasure);
}

const context = (levelPath: string, domainMode: boolean) => ({
  graph,
  analysis,
  levelPath,
  domainMode,
});

describe('clockDecor', () => {
  it('adds nothing outside the domain mode without a selected tree', async () => {
    const decor = clockDecor(await layoutOf('/'), context('/', false), {
      kind: 'net',
      id: '/::axi_dma_0_M_AXIS_MM2S',
    });
    expect(decor.tree).toBeUndefined();
    expect(decor.edges.size + decor.pinMarks.size + decor.domains.size).toBe(0);
    expect(decor.legend).toBeNull();
  });

  it('styles the wires, marks the pins and strips the blocks in the domain mode', async () => {
    const layout = await layoutOf('/');
    const decor = clockDecor(layout, context('/', true), null);
    const marksOf = (netId: string) =>
      layout.edges
        .filter((edge) => edge.data.netId === netId)
        .map((edge) => decor.edges.get(edge.id));
    // A clock or reset net has no wire: its pins carry the domain color.
    expect(marksOf('/::processing_system7_0_FCLK_CLK1')).toEqual([]);
    expect(decor.pinMarks.get(DSP)?.dsp_clk?.color).toBe(DOMAIN_COLORS[2]);
    expect(decor.pinMarks.get('/axi_dma_0')?.axi_resetn?.color).toBe(
      decor.pinMarks.get('/axi_dma_0')?.s_axi_lite_aclk?.color
    );
    // The wire into axi_dma_0/S_AXIS_S2MM crosses from FCLK_CLK1 to FCLK_CLK0.
    expect(marksOf('/::dsp_pipeline_M_AXIS')).toEqual([{ crossing: true }]);
    expect(marksOf('/::ps7_0_axi_periph_M00_AXI')).toEqual([{ dimmed: true }]);
    expect(decor.pinMarks.get('/axi_dma_0')?.s_axi_lite_aclk?.frequency).toBe('100 MHz');
    expect(decor.domains.get(DSP)).toMatchObject({ cdc: 2, rdc: 2 });
    expect(decor.domains.has('/::ext_clk')).toBe(false);
    expect(decor.legend?.map((entry) => entry.label)).toContain('FCLK_CLK1 · 200 MHz');
  });

  it('lists the domains of the level on show in the legend', async () => {
    const layout = await layoutOf(DSP);
    const decor = clockDecor(layout, context(DSP, true), null);
    expect(decor.legend?.map((entry) => entry.label).slice(0, 2)).toEqual([
      'FCLK_CLK0 · 100 MHz',
      'FCLK_CLK1 · 200 MHz',
    ]);
  });

  it('marks the connection of a data crossing and the failing sink pins of a reset crossing', async () => {
    const layout = await layoutOf(DSP);
    const decor = clockDecor(layout, context(DSP, true), null);
    const crossing = layout.edges.filter((edge) => decor.edges.get(edge.id)?.crossing);
    expect(
      crossing.map((edge) => `${edge.data.netId}>${edge.target}:${edge.targetHandle}`).sort()
    ).toEqual([
      // The data crossing to the root marks every net of its connection.
      `${DSP}::Conn2>${DSP}::M_AXIS:M_AXIS`,
      `${DSP}::fir_ctrl_0_M_AXIS_CONFIG>${DSP}/fir_compiler_0:S_AXIS_CONFIG`,
    ]);
    expect(decor.pinMarks.get(`${DSP}/fir_compiler_0`)?.aresetn?.crossing).toBe(true);
    expect(decor.pinMarks.get(`${DSP}/ovf_monitor_0`)?.rst_n?.crossing).toBe(true);
  });

  it('hands the nets of a selected clock tree to the nodes and marks its pins', async () => {
    const layout = await layoutOf('/');
    const decor = clockDecor(layout, context('/', false), {
      kind: 'net',
      id: '/::processing_system7_0_FCLK_CLK1',
    });
    expect(decor.tree?.kind).toBe('clock');
    expect(decor.tree?.netIds.has(`${DSP}::dsp_clk_1`)).toBe(true);
    expect(decor.edges.size).toBe(0);
    const highlighted = highlightedPinsByNode(decor.tree!.netIds, layout.edges, layout.nodes);
    expect(highlighted.get('/processing_system7_0')).toEqual(new Set(['FCLK_CLK1']));
    expect(highlighted.get(DSP)).toEqual(new Set(['dsp_clk']));
    expect(decor.pinMarks.get(DSP)?.dsp_clk?.frequency).toBe('200 MHz');
    expect(decor.pinMarks.has('/axi_dma_0')).toBe(false);
    expect(decor.legend).toBeNull();
    expect(decor.domains.size).toBe(0);
  });

  it('selects a clock tree across an expanded block: its inner pins and marks', async () => {
    const layout = await layoutOf('/', [DSP]);
    const decor = clockDecor(layout, context('/', false), {
      kind: 'net',
      id: '/::processing_system7_0_FCLK_CLK1',
    });
    expect(decor.tree?.netIds.has(`${DSP}::dsp_clk_1`)).toBe(true);

    const highlighted = highlightedPinsByNode(decor.tree!.netIds, layout.edges, layout.nodes);
    expect(highlighted.get(DSP)).toEqual(new Set(['dsp_clk']));
    expect(highlighted.get(`${DSP}/fir_compiler_0`)).toEqual(new Set(['aclk']));
    expect(highlighted.has('/axi_dma_0')).toBe(false);

    expect(decor.pinMarks.get(DSP)?.dsp_clk?.frequency).toBe('200 MHz');
    expect(decor.pinMarks.get(`${DSP}/fir_compiler_0`)?.aclk).toEqual({
      color: DOMAIN_COLORS[2],
      frequency: '200 MHz',
    });
    expect(decor.pinMarks.get(`${DSP}/axis_data_fifo_0`)?.m_axis_aclk?.frequency).toBe('200 MHz');
    expect(decor.pinMarks.has(`${DSP}/fir_ctrl_0`)).toBe(false);
  });
});
