import { analyzeClocks } from '../../../../webview/systemDiagram/clocks/analyzeClocks';
import { netTreeRows, type TreeRow } from '../../../../webview/systemDiagram/clocks/netTree';
import {
  domainRelations,
  frequencyCheck,
  netCrossings,
  resetCheck,
  resetRelations,
  resetSinkChecks,
} from '../../../../webview/systemDiagram/clocks/treeChecks';
import { endKey } from '../../../../webview/systemDiagram/clocks/physicalNets';
import type { PinCrossing } from '../../../../webview/systemDiagram/clocks/clockTypes';
import { loadClockFixtureGraph } from './fixtureGraph';
import { loadInnerResetGraph, loadQsysTwoClockGraph } from './clockTestGraphs';

const DSP = '/dsp_pipeline';

/** A compact text of the rows: `depth kind label`. */
function outline(rows: readonly TreeRow[]): string[] {
  return rows.map((row) =>
    row.kind === 'net'
      ? `${row.depth} net ${row.levelName}::${row.net.name}`
      : `${row.depth} ${row.role} ${row.label}`
  );
}

describe('netTreeRows', () => {
  const graph = loadClockFixtureGraph();
  const analysis = analyzeClocks(graph);

  it('walks a clock from its source into the hierarchy, one depth per level', () => {
    const domain = analysis.domains.find((candidate) => candidate.name === 'FCLK_CLK0')!;
    const rows = outline(netTreeRows(graph, domain.sourceNetId, domain.sourceRef));
    expect(rows).toEqual([
      '1 net zynq_clock_domains::processing_system7_0_FCLK_CLK0',
      '1 load processing_system7_0/M_AXI_GP0_ACLK',
      '1 load rst_ps7_0_100M/slowest_sync_clk',
      '1 load ps7_0_axi_periph/aclk',
      '1 load axi_dma_0/s_axi_lite_aclk',
      '1 load axi_dma_0/m_axi_mm2s_aclk',
      '1 load axi_dma_0/m_axi_s2mm_aclk',
      '1 enter dsp_pipeline/aclk',
      '2 net dsp_pipeline::aclk_1',
      '2 load axis_data_fifo_0/s_axis_aclk',
      '2 load fir_ctrl_0/clk',
    ]);
  });

  it('gives each hierarchy pin its own nested net', () => {
    const domain = analysis.domains.find((candidate) => candidate.name === 'FCLK_CLK1')!;
    expect(outline(netTreeRows(graph, domain.sourceNetId, domain.sourceRef))).toEqual([
      '1 net zynq_clock_domains::processing_system7_0_FCLK_CLK1',
      '1 enter dsp_pipeline/dsp_clk',
      '2 net dsp_pipeline::dsp_clk_1',
      '2 load axis_data_fifo_0/m_axis_aclk',
      '2 load fir_compiler_0/aclk',
      '2 load ovf_monitor_0/clk',
    ]);
  });

  it('lists a root external port as a port and carries the pin and level of each row', () => {
    const rows = netTreeRows(graph, '/::ext_resetn_1', { instance: null, pin: 'ext_resetn' });
    const load = rows.find((row) => row.kind === 'pin');
    expect(load).toMatchObject({
      role: 'load',
      level: '/',
      ref: { instance: '/ext_fifo_0', pin: 's_axis_aresetn' },
      nodeId: '/ext_fifo_0',
    });
  });

  it('follows a reset out of a hierarchy through its boundary pin', () => {
    const inner = loadInnerResetGraph();
    const reset = analyzeClocks(inner).resets[0];
    expect(outline(netTreeRows(inner, reset.netId, reset.source))).toEqual([
      '1 net h::r_out',
      '1 exit rst_out',
      '2 net inner_reset::h_rst',
      '2 load b/rst_n',
      '1 load r2/rst_n',
    ]);
  });

  it('continues through a clock-forwarding block to its output net', () => {
    const qsys = loadQsysTwoClockGraph();
    const domain = analyzeClocks(qsys).domains[0];
    const rows = netTreeRows(qsys, domain.sourceNetId, domain.sourceRef);
    const forward = rows.findIndex(
      (row) => row.kind === 'pin' && row.role === 'load' && row.label === 'clk_a/clk_in'
    );
    expect(forward).toBeGreaterThanOrEqual(0);
    expect(rows.slice(forward + 1).some((row) => row.kind === 'net' && row.depth === 2)).toBe(true);
  });

  it('is empty for a net that does not exist', () => {
    expect(netTreeRows(graph, '/::missing', { instance: null, pin: 'x' })).toEqual([]);
  });
});

describe('row checks', () => {
  const graph = loadClockFixtureGraph();
  const analysis = analyzeClocks(graph);
  const resetCrossings = analysis.crossings.filter(
    (crossing): crossing is PinCrossing => crossing.kind === 'reset'
  );
  const crossingOf = (label: string) =>
    resetCrossings.find((crossing) => crossing.to.label === label)!;

  it('checks an expected frequency: match, mismatch, unknown', () => {
    const expected = { expected: '100MHz', status: 'match' as const };
    expect(frequencyCheck(expected)).toEqual({ tone: 'ok', text: '✓ .ip.yml expects 100MHz' });
    expect(frequencyCheck({ ...expected, status: 'mismatch' })).toEqual({
      tone: 'warning',
      text: '✗ .ip.yml expects 100MHz',
    });
    expect(frequencyCheck({ ...expected, status: 'unknown' })).toMatchObject({ tone: 'muted' });
  });

  it('checks a reset sink: released on its clock, clocked by another, unknown, asynchronous', () => {
    expect(resetCheck(crossingOf('fir_ctrl_0/rst_n'))).toMatchObject({
      tone: 'ok',
      text: '✓ FCLK_CLK0',
    });
    expect(resetCheck(crossingOf('fir_compiler_0/aresetn'))).toMatchObject({
      tone: 'warning',
      text: '✗ clocked by FCLK_CLK1 · 200 MHz',
    });
    expect(resetCheck(crossingOf('axis_data_fifo_0/s_axis_aresetn'))).toMatchObject({
      tone: 'muted',
      text: '? clock unknown',
    });
    expect(resetCheck(crossingOf('rst_ps7_0_100M/ext_reset_in'))).toMatchObject({
      tone: 'ok',
      text: '✓ asynchronous input',
    });
  });

  it('keys the checks of a reset by sink', () => {
    const reset = analysis.resets.find((candidate) =>
      candidate.label.endsWith('peripheral_aresetn')
    )!;
    const checks = resetSinkChecks(analysis, reset);
    expect(checks.size).toBe(reset.sinks.length);
    const sink = reset.sinks.find(
      (end) => end.pin === 'aresetn' && end.instance === `${DSP}/fir_compiler_0`
    )!;
    expect(checks.get(endKey(sink))?.tone).toBe('warning');
  });
});

describe('relations', () => {
  const graph = loadClockFixtureGraph();
  const analysis = analyzeClocks(graph);
  const domain = (name: string) => analysis.domains.find((candidate) => candidate.name === name)!;

  it('lists the resets released on a domain, its flagged data crossings and the blocks that span it', () => {
    const relations = domainRelations(analysis, domain('FCLK_CLK0'));
    expect(relations.resets.map((reset) => reset.label)).toEqual([
      'rst_ps7_0_100M/peripheral_aresetn',
    ]);
    expect(relations.crossings.map((crossing) => crossing.to.label).sort()).toEqual([
      'axi_dma_0/S_AXIS_S2MM',
      'fir_compiler_0/S_AXIS_CONFIG',
    ]);
    expect(relations.spanning.map((block) => block.instance)).toEqual([`${DSP}/axis_data_fifo_0`]);
    expect(domainRelations(analysis, domain('FCLK_CLK1')).resets).toEqual([]);
  });

  it('lists the flagged reset crossings of a reset and the domains of the sinks they hit', () => {
    const reset = analysis.resets.find((candidate) =>
      candidate.label.endsWith('peripheral_aresetn')
    )!;
    const relations = resetRelations(analysis, reset);
    expect(relations.crossings.map((crossing) => crossing.to.label).sort()).toEqual([
      'fir_compiler_0/aresetn',
      'ovf_monitor_0/rst_n',
    ]);
    expect(relations.domains.map((candidate) => candidate.name)).toEqual(['FCLK_CLK1']);
  });

  it('lists the data crossings that touch a net, fine ones once per reason', () => {
    const notes = netCrossings(analysis, `${DSP}::axis_data_fifo_0_M_AXIS`);
    expect(notes.map((crossing) => crossing.status)).toEqual(['unchecked']);
    const ok = netCrossings(analysis, '/::processing_system7_0_M_AXI_GP0');
    expect(ok.map((crossing) => crossing.reason)).toEqual(['Both ends on FCLK_CLK0']);
    expect(netCrossings(analysis, '/::processing_system7_0_FCLK_CLK0')).toEqual([]);
  });
});
