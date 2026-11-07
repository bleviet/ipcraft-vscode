import {
  analyzeClocks,
  type ClockAnalysis,
} from '../../../../webview/systemDiagram/clocks/analyzeClocks';
import type {
  Crossing,
  CrossingKind,
  CrossingStatus,
  PinCrossing,
} from '../../../../webview/systemDiagram/clocks/clockTypes';
import { loadFeedThroughGraph, loadQsysTwoClockGraph, loadTwoClockGraph } from './clockTestGraphs';
import {
  loadClockFixtureGraph,
  loadFixtureGraph,
  loadQsysFixtureGraph,
  loadQsysTclFixtureGraph,
} from './fixtureGraph';

const DSP = '/dsp_pipeline';
const FIFO = `${DSP}/axis_data_fifo_0`;

function pinCrossings(analysis: ClockAnalysis, kind: CrossingKind): PinCrossing[] {
  return analysis.crossings.filter((x): x is PinCrossing => x.kind === kind);
}

/** The crossing from `from` to `to`, both as `instanceName/pin` or port name. */
function between(analysis: ClockAnalysis, kind: 'data' | 'reset', from: string, to: string) {
  return pinCrossings(analysis, kind).find((x) => x.from.label === from && x.to.label === to)!;
}

const summary = (crossings: readonly Crossing[]) =>
  crossings.map((x) =>
    x.kind === 'block'
      ? `${x.status} block ${x.instance}`
      : `${x.status} ${x.kind} ${x.from.label} -> ${x.to.label}`
  );

describe('crossings of the clock fixture', () => {
  const graph = loadClockFixtureGraph();
  const analysis = analyzeClocks(graph);

  it('lists crossings first, then blocks, unchecked and ok; data before reset', () => {
    expect(summary(analysis.crossings)).toEqual([
      'cross data fir_compiler_0/M_AXIS_DATA -> axi_dma_0/S_AXIS_S2MM',
      'cross data fir_ctrl_0/M_AXIS_CONFIG -> fir_compiler_0/S_AXIS_CONFIG',
      'cross reset rst_ps7_0_100M/peripheral_aresetn -> fir_compiler_0/aresetn',
      'cross reset rst_ps7_0_100M/peripheral_aresetn -> ovf_monitor_0/rst_n',
      `inside block ${FIFO}`,
      'unchecked data axis_data_fifo_0/M_AXIS -> fir_compiler_0/S_AXIS_DATA',
      'unchecked data axi_dma_0/M_AXIS_MM2S -> axis_data_fifo_0/S_AXIS',
      'unchecked reset rst_ps7_0_100M/peripheral_aresetn -> axis_data_fifo_0/s_axis_aresetn',
      'ok data S_AXIS_EXT -> ext_fifo_0/S_AXIS',
      'ok data processing_system7_0/M_AXI_GP0 -> ps7_0_axi_periph/S00_AXI',
      'ok data ps7_0_axi_periph/M00_AXI -> axi_dma_0/S_AXI_LITE',
      'ok data ps7_0_axi_periph/M01_AXI -> fir_ctrl_0/S_AXI',
      'ok reset ext_resetn -> ext_fifo_0/s_axis_aresetn',
      'ok reset processing_system7_0/FCLK_RESET0_N -> rst_ps7_0_100M/ext_reset_in',
      'ok reset rst_ps7_0_100M/peripheral_aresetn -> fir_ctrl_0/rst_n',
      'ok reset rst_ps7_0_100M/peripheral_aresetn -> ps7_0_axi_periph/aresetn',
      'ok reset rst_ps7_0_100M/peripheral_aresetn -> axi_dma_0/axi_resetn',
    ]);
  });

  it('finds the CDC from the FIR compiler to the DMA across the hierarchy', () => {
    const crossing = between(
      analysis,
      'data',
      'fir_compiler_0/M_AXIS_DATA',
      'axi_dma_0/S_AXIS_S2MM'
    );
    expect(crossing).toMatchObject({
      id: `data:${DSP}|${DSP}/fir_compiler_0::M_AXIS_DATA>/|/axi_dma_0::S_AXIS_S2MM`,
      status: 'cross',
      category: 'axis',
      // The shallowest net, which the diagram of the top level draws.
      netId: '/::dsp_pipeline_M_AXIS',
      level: '/',
      netIds: [`${DSP}::Conn2`, '/::dsp_pipeline_M_AXIS'],
      reason:
        'fir_compiler_0/M_AXIS_DATA is on FCLK_CLK1 and axi_dma_0/S_AXIS_S2MM on FCLK_CLK0; no synchronizer is known between them',
    });
    expect(crossing.from).toMatchObject({
      level: DSP,
      instance: `${DSP}/fir_compiler_0`,
      pin: 'M_AXIS_DATA',
      nodeId: `${DSP}/fir_compiler_0`,
      clockPin: 'aclk',
      knownFrom: 'single clock',
      domain: { name: 'FCLK_CLK1' },
    });
    expect(crossing.to).toMatchObject({
      level: '/',
      instance: '/axi_dma_0',
      pin: 'S_AXIS_S2MM',
      knownFrom: 'all clocks one domain',
      domain: { name: 'FCLK_CLK0' },
    });
    expect(crossing.to.clockPin).toBeUndefined();
  });

  it('finds the CDC from a one-clock block to another across a domain', () => {
    const crossing = between(
      analysis,
      'data',
      'fir_ctrl_0/M_AXIS_CONFIG',
      'fir_compiler_0/S_AXIS_CONFIG'
    );
    expect(crossing).toMatchObject({
      status: 'cross',
      level: DSP,
      netId: `${DSP}::fir_ctrl_0_M_AXIS_CONFIG`,
    });
    expect([crossing.from.domain?.name, crossing.to.domain?.name]).toEqual([
      'FCLK_CLK0',
      'FCLK_CLK1',
    ]);
  });

  it('finds the RDC on the reset pins clocked by the faster domain', () => {
    for (const sink of ['fir_compiler_0/aresetn', 'ovf_monitor_0/rst_n']) {
      const crossing = between(analysis, 'reset', 'rst_ps7_0_100M/peripheral_aresetn', sink);
      expect(crossing).toMatchObject({
        status: 'cross',
        level: DSP,
        netId: `${DSP}::aresetn_1`,
        // The whole reset tree, both levels.
        netIds: [`${DSP}::aresetn_1`, '/::rst_ps7_0_100M_peripheral_aresetn'],
      });
      expect(crossing.from).toMatchObject({
        level: '/',
        label: 'rst_ps7_0_100M/peripheral_aresetn',
        async: false,
        knownFrom: 'proc_sys_reset slowest_sync_clk',
        domain: { name: 'FCLK_CLK0' },
      });
      expect(crossing.to).toMatchObject({
        knownFrom: 'single clock',
        domain: { name: 'FCLK_CLK1' },
      });
      expect(crossing.reason).toBe(
        `${sink} is clocked by FCLK_CLK1 but its reset rst_ps7_0_100M/peripheral_aresetn is released on FCLK_CLK0`
      );
    }
  });

  it('accepts an asynchronous reset on ext_reset_in', () => {
    const crossing = between(
      analysis,
      'reset',
      'processing_system7_0/FCLK_RESET0_N',
      'rst_ps7_0_100M/ext_reset_in'
    );
    expect(crossing).toMatchObject({
      status: 'ok',
      reason: 'The input accepts an asynchronous reset',
    });
    expect(crossing.from).toMatchObject({ async: true, knownFrom: 'PS reset, asynchronous' });
    expect(crossing.to).toMatchObject({ async: true, knownFrom: 'asynchronous input' });
  });

  it('lists a leaf block on two domains as inside, never a hierarchy', () => {
    const blocks = analysis.crossings.filter((x) => x.kind === 'block');
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({
      id: `block:${FIFO}`,
      status: 'inside',
      instance: FIFO,
      level: DSP,
      netIds: [],
      reason: 'axis_data_fifo_0 has clocks on FCLK_CLK0, FCLK_CLK1; review that it synchronizes',
    });
    expect(blocks[0].kind === 'block' && blocks[0].domains.map((d) => d.name)).toEqual([
      'FCLK_CLK0',
      'FCLK_CLK1',
    ]);
  });

  it('leaves the interfaces of that block unchecked and names the block and the pin', () => {
    const into = between(analysis, 'data', 'axi_dma_0/M_AXIS_MM2S', 'axis_data_fifo_0/S_AXIS');
    expect(into).toMatchObject({
      status: 'unchecked',
      level: '/',
      reason: 'axis_data_fifo_0 has clocks on 2 domains; the clock of S_AXIS is in its definition',
    });
    expect(into.to.domain).toBeUndefined();
    expect(into.from.domain?.name).toBe('FCLK_CLK0');
    const out = between(analysis, 'data', 'axis_data_fifo_0/M_AXIS', 'fir_compiler_0/S_AXIS_DATA');
    expect(out.status).toBe('unchecked');
    const reset = between(
      analysis,
      'reset',
      'rst_ps7_0_100M/peripheral_aresetn',
      'axis_data_fifo_0/s_axis_aresetn'
    );
    expect(reset).toMatchObject({
      status: 'unchecked',
      reason:
        'axis_data_fifo_0 has clocks on 2 domains; the clock of s_axis_aresetn is in its definition',
    });
  });

  it('checks root ports through the clock port that lists them', () => {
    const data = between(analysis, 'data', 'S_AXIS_EXT', 'ext_fifo_0/S_AXIS');
    expect(data).toMatchObject({ status: 'ok', reason: 'Both ends on ext_clk' });
    expect(data.from).toMatchObject({
      nodeId: '/::S_AXIS_EXT',
      knownFrom: 'CONFIG.ASSOCIATED_BUSIF',
      clockPin: 'ext_clk',
    });
    const reset = between(analysis, 'reset', 'ext_resetn', 'ext_fifo_0/s_axis_aresetn');
    expect(reset).toMatchObject({ status: 'ok', reason: 'Released on ext_clk' });
    expect(reset.from).toMatchObject({ knownFrom: 'CONFIG.ASSOCIATED_RESET', async: false });
  });

  it('finds the fifo interfaces ok once the definition names the clocks', () => {
    const defined = loadClockFixtureGraph();
    const pin = (name: string) =>
      defined.instances[FIFO].pins.find((candidate) => candidate.name === name)!;
    pin('S_AXIS').associatedClock = 's_axis_aclk';
    pin('M_AXIS').associatedClock = 'm_axis_aclk';
    pin('s_axis_aresetn').associatedClock = 's_axis_aclk';
    const result = analyzeClocks(defined);
    expect(result.crossings.filter((x) => x.status === 'unchecked')).toEqual([]);
    expect(
      between(result, 'data', 'axis_data_fifo_0/M_AXIS', 'fir_compiler_0/S_AXIS_DATA').status
    ).toBe('ok');
    expect(
      between(
        result,
        'reset',
        'rst_ps7_0_100M/peripheral_aresetn',
        'axis_data_fifo_0/s_axis_aresetn'
      ).status
    ).toBe('ok');
    // The block still spans two domains.
    expect(result.crossings.filter((x) => x.status === 'inside')).toHaveLength(1);
  });

  it('is unchecked when no rule says which clock releases a reset', () => {
    const unknown = loadClockFixtureGraph();
    unknown.instances['/rst_ps7_0_100M'].vlnv = 'xilinx.com:ip:other_reset:1.0';
    // The pin is a known output (its definition says so), but no rule knows its release.
    const output = unknown.instances['/rst_ps7_0_100M'].pins.find(
      (pin) => pin.name === 'peripheral_aresetn'
    )!;
    output.direction = 'out';
    output.directionSource = 'definition';
    const result = analyzeClocks(unknown);
    const crossing = between(
      result,
      'reset',
      'rst_ps7_0_100M/peripheral_aresetn',
      'fir_compiler_0/aresetn'
    );
    expect(crossing).toMatchObject({
      status: 'unchecked',
      reason: 'No rule says which clock rst_ps7_0_100M/peripheral_aresetn is synchronized to',
    });
    expect(crossing.from.domain).toBeUndefined();
    expect(crossing.from.async).toBe(false);
    const source = result.resets.find((r) => r.label === 'rst_ps7_0_100M/peripheral_aresetn')!;
    expect(source.async).toBe(false);
    expect(source.domain).toBeUndefined();
    expect(source.from).toBeUndefined();
  });

  it('flags an asynchronous reset that feeds a clocked sink', () => {
    const asyncReset = loadClockFixtureGraph();
    asyncReset.instances['/ps7_0_axi_periph'].pins.push({
      name: 'aux_aresetn',
      isInterface: false,
      direction: 'in',
      directionSource: 'declared',
      parameters: {},
    });
    asyncReset.nets
      .find((net) => net.id === '/::processing_system7_0_FCLK_RESET0_N')!
      .endpoints.push({ instance: '/ps7_0_axi_periph', pin: 'aux_aresetn' });
    const crossing = between(
      analyzeClocks(asyncReset),
      'reset',
      'processing_system7_0/FCLK_RESET0_N',
      'ps7_0_axi_periph/aux_aresetn'
    );
    expect(crossing).toMatchObject({
      status: 'cross',
      reason:
        'ps7_0_axi_periph/aux_aresetn is clocked by FCLK_CLK0 but its reset processing_system7_0/FCLK_RESET0_N is asynchronous',
    });
    expect(crossing.from.async).toBe(true);
  });

  it('reports a port that no clock port lists as unchecked', () => {
    const unlisted = loadClockFixtureGraph();
    delete unlisted.levels['/'].boundaryPins.find((pin) => pin.name === 'ext_clk')!.parameters[
      'CONFIG.ASSOCIATED_BUSIF'
    ];
    const crossing = between(analyzeClocks(unlisted), 'data', 'S_AXIS_EXT', 'ext_fifo_0/S_AXIS');
    expect(crossing).toMatchObject({
      status: 'unchecked',
      reason: 'external port S_AXIS_EXT is not listed in CONFIG.ASSOCIATED_BUSIF of a clock port',
    });
  });

  it('gives crossings unique ids', () => {
    const ids = analysis.crossings.map((x) => x.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('records the reset sources with their release', () => {
    expect(
      analysis.resets.map((r) => [r.label, r.async, r.domain?.name, r.from, r.sinks.length])
    ).toEqual([
      ['ext_resetn', false, 'ext_clk', 'CONFIG.ASSOCIATED_RESET', 1],
      ['processing_system7_0/FCLK_RESET0_N', true, undefined, 'PS reset, asynchronous', 1],
      [
        'rst_ps7_0_100M/peripheral_aresetn',
        false,
        'FCLK_CLK0',
        'proc_sys_reset slowest_sync_clk',
        6,
      ],
    ]);
    const peripheral = analysis.resets[2];
    expect(peripheral).toMatchObject({
      id: 'reset:2',
      index: 2,
      netId: '/::rst_ps7_0_100M_peripheral_aresetn',
      netIds: [`${DSP}::aresetn_1`, '/::rst_ps7_0_100M_peripheral_aresetn'],
      line: graph.nets.find((net) => net.id === '/::rst_ps7_0_100M_peripheral_aresetn')?.line,
      source: { level: '/', instance: '/rst_ps7_0_100M', pin: 'peripheral_aresetn' },
    });
  });

  it('looks a reset source up from any net or pin of its tree', () => {
    const peripheral = analysis.resets[2];
    expect(analysis.resetOfNet(`${DSP}::aresetn_1`)).toBe(peripheral);
    expect(analysis.resetOfNet('/::rst_ps7_0_100M_peripheral_aresetn')).toBe(peripheral);
    expect(analysis.resetOfPin(DSP, { instance: `${DSP}/fir_compiler_0`, pin: 'aresetn' })).toBe(
      peripheral
    );
    expect(analysis.resetOfPin('/', { instance: DSP, pin: 'aresetn' })).toBe(peripheral);
    expect(analysis.resetOfNet(`${DSP}::aclk_1`)).toBeUndefined();
    expect(analysis.resetOfPin('/', { instance: '/axi_dma_0', pin: 'M_AXI_MM2S' })).toBeUndefined();
  });
});

describe('crossings of the plain zynq fixture', () => {
  const analysis = analyzeClocks(loadFixtureGraph());

  it('has no crossing: one domain, so everything is ok, async or not checked', () => {
    expect(analysis.crossings.filter((x) => x.status === 'cross' || x.status === 'inside')).toEqual(
      []
    );
    const unchecked = analysis.crossings.filter((x) => x.status === 'unchecked');
    expect(summary(unchecked)).toEqual([]);
    // A constant tied to a reset input never toggles: one row for its sink, none for the driver.
    const constant = analysis.crossings.filter(
      (x) => x.kind === 'reset' && x.from.label === 'tie_valid/dout'
    );
    expect(summary(constant)).toEqual(['ok reset tie_valid/dout -> config_fifo/s_axis_aresetn']);
    expect(constant[0].reason).toBe('Tied to a constant');
  });
});

function statusCount(analysis: ClockAnalysis, status: CrossingStatus): number {
  return analysis.crossings.filter((x) => x.status === status).length;
}

describe('crossings on Platform Designer systems', () => {
  it('turns a crossing into ok: Platform Designer inserts the adapters', () => {
    const analysis = analyzeClocks(loadQsysTwoClockGraph());
    const data = between(analysis, 'data', 'mst/m0', 'slv/s0');
    expect(data).toMatchObject({ status: 'ok', reason: 'Handled by Platform Designer' });
    // The domains are still known on both ends.
    expect([data.from.domain?.name, data.to.domain?.name]).toEqual(['clk_in', 'clk']);
    const reset = between(analysis, 'reset', 'clk_a/clk_reset', 'slv/reset');
    expect(reset).toMatchObject({ status: 'ok', reason: 'Handled by Platform Designer' });
    // clk_a releases its reset synchronously when resetSynchronousEdges is DEASSERT.
    expect(reset.from).toMatchObject({ async: false, domain: { name: 'clk_in' } });
    expect(statusCount(analysis, 'cross')).toBe(0);
  });

  it('would flag the same design as a crossing in a Vivado script', () => {
    const graph = loadQsysTwoClockGraph();
    graph.source.format = 'vivado-bd-tcl';
    const analysis = analyzeClocks(graph);
    expect(statusCount(analysis, 'cross')).toBe(2);
  });

  it('has no crossing on the nios system, whose reset is asynchronous', () => {
    const analysis = analyzeClocks(loadQsysFixtureGraph());
    expect(statusCount(analysis, 'cross')).toBe(0);
    const reset = between(analysis, 'reset', 'clk_0/clk_reset', 'nios2_gen2_0/reset');
    expect(reset).toMatchObject({ status: 'ok', reason: 'Handled by Platform Designer' });
    expect(reset.from).toMatchObject({
      async: true,
      knownFrom: 'clock_source resetSynchronousEdges = NONE',
    });
  });

  it('keeps the second driver of a shared sink as its own reset source', () => {
    const analysis = analyzeClocks(loadQsysFixtureGraph());
    expect(analysis.resets.map((r) => r.label)).toEqual([
      'clk_0/clk_reset',
      'nios2_gen2_0/debug_reset_request',
      'reset',
    ]);
    expect(analysis.resets[1].sinks.map((end) => `${end.instance}::${end.pin}`)).toEqual([
      '/onchip_memory2_0::reset1',
      '/jtag_uart_0::reset',
      '/pio_0::reset',
    ]);
    const unknown = between(
      analysis,
      'reset',
      'nios2_gen2_0/debug_reset_request',
      'jtag_uart_0/reset'
    );
    // No rule knows what releases it, but Platform Designer synchronizes each sink domain.
    expect(unknown).toMatchObject({ status: 'ok', reason: 'Handled by Platform Designer' });
    expect(unknown.from.domain).toBeUndefined();
    expect(unknown.from.async).toBe(false);
  });

  it('takes the reset input of a clock_source as asynchronous', () => {
    const analysis = analyzeClocks(loadQsysFixtureGraph());
    const crossing = between(analysis, 'reset', 'reset', 'clk_0/clk_in_reset');
    expect(crossing).toMatchObject({
      status: 'ok',
      reason: 'The input accepts an asynchronous reset',
    });
    expect(crossing.to).toMatchObject({ async: true, knownFrom: 'asynchronous input' });
  });

  it('leaves a reset sink with an unknown clock unchecked, and handles one with a known clock', () => {
    const analysis = analyzeClocks(loadQsysTclFixtureGraph());
    expect(between(analysis, 'reset', 'reset_bridge/out_reset', 'led_pio/reset')).toMatchObject({
      status: 'unchecked',
      reason: 'led_pio has clocks on 2 domains; the clock of reset is in its definition',
    });
    expect(between(analysis, 'reset', 'reset_bridge/out_reset', 'niosv/reset')).toMatchObject({
      status: 'ok',
      reason: 'Handled by Platform Designer',
    });
  });

  it('needs no adapter for a reset released on the clock of its sink', () => {
    const graph = loadQsysTwoClockGraph();
    // Put the slave on the clock that releases the reset.
    const net = (id: string) => graph.nets.find((candidate) => candidate.id === id)!;
    net('/::clk_b.clk').endpoints = net('/::clk_b.clk').endpoints.filter(
      (ref) => ref.instance !== '/slv'
    );
    net('/::clk_a.clk').endpoints.push({ instance: '/slv', pin: 'clk' });
    const reset = between(analyzeClocks(graph), 'reset', 'clk_a/clk_reset', 'slv/reset');
    expect(reset).toMatchObject({ status: 'ok', reason: 'Released on clk_in' });
  });

  it('reads a qsys-script system without a frequency or reset rule as not checked', () => {
    const analysis = analyzeClocks(loadQsysTclFixtureGraph());
    expect(statusCount(analysis, 'cross')).toBe(0);
    expect(statusCount(analysis, 'unchecked')).toBeGreaterThan(0);
  });
});

describe('crossings of a design with two clocks', () => {
  const analysis = analyzeClocks(loadTwoClockGraph());

  it('flags the stream and the reset', () => {
    expect(summary(analysis.crossings.filter((x) => x.status === 'cross'))).toEqual([
      'cross data a/M_AXIS -> b/S_AXIS',
      'cross reset rst/peripheral_aresetn -> b/rst_n',
    ]);
    expect(statusCount(analysis, 'ok')).toBe(1);
  });
});

describe('crossings through a hierarchy that only passes a stream on', () => {
  const analysis = analyzeClocks(loadFeedThroughGraph());
  const crossing = between(analysis, 'data', 'a/M_AXIS', 'b/S_AXIS');

  it('finds the crossing between the blocks on either side of the hierarchy', () => {
    expect(crossing.status).toBe('cross');
    expect(crossing.netIds).toEqual(['/h::feed', '/::h_to_b', '/::a_to_h']);
    // The hierarchy pins are pass-through: neither is an end of the crossing.
    expect([crossing.from.instance, crossing.to.instance]).toEqual(['/a', '/b']);
  });

  it('belongs to the top level and opens the net of the driver there', () => {
    // /h::feed is the deepest member and first in graph order; /::h_to_b is the first one at the
    // top level, but /::a_to_h holds the driver and is just as shallow.
    expect(crossing.level).toBe('/');
    expect(crossing.netId).toBe('/::a_to_h');
  });
});
