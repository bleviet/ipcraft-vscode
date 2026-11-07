import { readBdTcl } from '../../../../parser/system/BdTclReader';
import type { SystemGraph } from '../../../../domain/systemGraph';
import { analyzeClocks } from '../../../../webview/systemDiagram/clocks/analyzeClocks';
import type { Crossing, PinCrossing } from '../../../../webview/systemDiagram/clocks/clockTypes';
import { crossingEdgeIds } from '../../../../webview/systemDiagram/clocks/crossingEdges';
import {
  crossingCounts,
  crossingEndKeys,
  crossingsWithin,
  toolbarSummary,
} from '../../../../webview/systemDiagram/clocks/crossingSummary';
import { outlineDomains } from '../../../../webview/systemDiagram/clocks/domainView';
import { loadPortClocksGraph, loadVersalClockGraph } from './fixtureGraph';

const pinCrossings = (crossings: readonly Crossing[]) =>
  crossings.filter((x): x is PinCrossing => x.kind !== 'block');

/** The crossing from `from` to `to`, both as `instanceName/pin` or port name. */
function between(crossings: readonly Crossing[], from: string, to: string): PinCrossing {
  return pinCrossings(crossings).find((x) => x.from.label === from && x.to.label === to)!;
}

/** A design script: a block, an instance per line, and the nets. */
function script(lines: string[]): SystemGraph {
  return readBdTcl(['create_bd_design "d"', ...lines].join('\n'), 'd.tcl');
}
const cell = (name: string, ip: string) =>
  `set ${name} [ create_bd_cell -type ip -vlnv ${ip} ${name} ]`;
const blk = (name: string) => cell(name, 'acme.com:ip:blk:1.0');

describe('clocks that enter through ports', () => {
  const graph = loadPortClocksGraph();
  const analysis = analyzeClocks(graph);

  it('is a port clock when its driver is a root input port', () => {
    expect(analysis.domains.map((d) => [d.name, d.portClock])).toEqual([
      ['m_axis_clk', true],
      ['s_axi_aclk', true],
    ]);
    expect(analysis.domains.map((d) => d.label)).toEqual(['m_axis_clk', 's_axi_aclk']);
  });

  it('puts the pins fed by one port on one clock', () => {
    const at = (instance: string, pin: string) => analysis.domainOfPin('/', { instance, pin });
    expect(at('/producer_0', 'aclk')).toBe(at('/monitor_0', 'clk'));
    expect(at('/producer_0', 'aclk')).toBe(analysis.domains[1]);
    expect(at('/consumer_0', 'aclk')).toBe(analysis.domains[0]);
  });

  it('reads the frequency of the port that declares -freq_hz, and none for the other', () => {
    const [m, s] = analysis.domains;
    expect(s.hz).toBe(100e6);
    expect(s.frequencyFrom).toMatchObject({
      parameter: 'CONFIG.FREQ_HZ',
      value: '100000000',
      kind: 'declared',
      owner: 's_axi_aclk',
    });
    expect(m.hz).toBeUndefined();
    expect(m.frequencyFrom).toBeUndefined();
  });

  it('does not check a stream between two port clocks', () => {
    const [crossing] = pinCrossings(analysis.crossings);
    expect(crossing).toMatchObject({
      kind: 'data',
      status: 'unchecked',
      reason:
        'Both clocks enter through ports (s_axi_aclk, m_axis_clk); the top level decides whether they are the same clock',
    });
    expect(crossing.from.label).toBe('producer_0/M_AXIS');
    expect(crossing.to.label).toBe('consumer_0/S_AXIS');
    expect(crossingCounts(analysis.crossings).cross).toBe(0);
  });

  it('does not check a reset between two port clocks either', () => {
    const reset = script([
      'create_bd_port -dir I -type clk clk_a',
      'create_bd_port -dir I -type clk clk_b',
      cell('rst', 'xilinx.com:ip:proc_sys_reset:5.0'),
      blk('a'),
      'connect_bd_net -net ca [get_bd_ports clk_a] [get_bd_pins rst/slowest_sync_clk]',
      'connect_bd_net -net cb [get_bd_pins a/clk] [get_bd_ports clk_b]',
      'connect_bd_net -net r [get_bd_pins a/rst_n] [get_bd_pins rst/peripheral_aresetn]',
    ]);
    const crossing = between(analyzeClocks(reset).crossings, 'rst/peripheral_aresetn', 'a/rst_n');
    expect(crossing).toMatchObject({
      kind: 'reset',
      status: 'unchecked',
      reason:
        'Both clocks enter through ports (clk_a, clk_b); the top level decides whether they are the same clock',
    });
  });

  it('keeps a crossing between a port clock and a clock made inside the design', () => {
    const mixed = script([
      'create_bd_port -dir I -type clk ext_clk',
      cell('ps', 'xilinx.com:ip:processing_system7:5.5'),
      blk('a'),
      blk('b'),
      'connect_bd_intf_net -intf_net n [get_bd_intf_pins a/M_AXIS] [get_bd_intf_pins b/S_AXIS]',
      'connect_bd_net -net pc [get_bd_pins ps/FCLK_CLK0] [get_bd_pins b/clk]',
      'connect_bd_net -net xc [get_bd_ports ext_clk] [get_bd_pins a/clk]',
    ]);
    const analysis = analyzeClocks(mixed);
    expect(analysis.domains.map((d) => [d.name, d.portClock])).toEqual([
      ['FCLK_CLK0', false],
      ['ext_clk', true],
    ]);
    expect(between(analysis.crossings, 'a/M_AXIS', 'b/S_AXIS').status).toBe('cross');
  });
});

describe('clocks whose source is not known', () => {
  it('does not check a stream between two clocks with unknown sources', () => {
    const both = script([
      blk('a'),
      blk('b'),
      'connect_bd_intf_net -intf_net n [get_bd_intf_pins a/M_AXIS] [get_bd_intf_pins b/S_AXIS]',
      'connect_bd_net -net clk_x [get_bd_pins a/clk]',
      'connect_bd_net -net clk_y [get_bd_pins b/clk]',
    ]);
    const analysis = analyzeClocks(both);
    expect(analysis.domains.map((d) => [d.name, d.sourceRef, d.portClock])).toEqual([
      ['clk_x', undefined, false],
      ['clk_y', undefined, false],
    ]);
    expect(between(analysis.crossings, 'a/M_AXIS', 'b/S_AXIS')).toMatchObject({
      status: 'unchecked',
      reason: 'The source of clk_x is not known, so its relation to clk_y is not known',
    });
  });

  it('names the net of the unknown source and the other clock', () => {
    const mixed = script([
      cell('ps', 'xilinx.com:ip:processing_system7:5.5'),
      blk('a'),
      blk('b'),
      'connect_bd_intf_net -intf_net n [get_bd_intf_pins a/M_AXIS] [get_bd_intf_pins b/S_AXIS]',
      'connect_bd_net -net clk_known [get_bd_pins ps/FCLK_CLK0] [get_bd_pins a/clk]',
      'connect_bd_net -net clk_loose [get_bd_pins b/clk] [get_bd_pins b/clk2]',
    ]);
    const crossing = between(analyzeClocks(mixed).crossings, 'a/M_AXIS', 'b/S_AXIS');
    expect(crossing.status).toBe('unchecked');
    expect(crossing.reason).toBe(
      'The source of clk_loose is not known, so its relation to FCLK_CLK0 is not known'
    );
  });

  it('does not check a reset released on a clock with an unknown source', () => {
    const reset = script([
      cell('rst', 'xilinx.com:ip:proc_sys_reset:5.0'),
      cell('ps', 'xilinx.com:ip:processing_system7:5.5'),
      blk('a'),
      'connect_bd_net -net clk_loose [get_bd_pins rst/slowest_sync_clk]',
      'connect_bd_net -net clk_known [get_bd_pins ps/FCLK_CLK0] [get_bd_pins a/clk]',
      'connect_bd_net -net r [get_bd_pins a/rst_n] [get_bd_pins rst/peripheral_aresetn]',
    ]);
    const crossing = between(analyzeClocks(reset).crossings, 'rst/peripheral_aresetn', 'a/rst_n');
    expect(crossing.status).toBe('unchecked');
    expect(crossing.reason).toBe(
      'The source of clk_loose is not known, so its relation to FCLK_CLK0 is not known'
    );
  });
});

describe('related clocks of one generator', () => {
  const graph = loadVersalClockGraph();
  const analysis = analyzeClocks(graph);
  const REASON = 'Both clocks come from clk_wizard_0; Vivado times paths between its outputs';

  it('marks a stream between two outputs of one wizard as related', () => {
    const crossing = between(analysis.crossings, 'stream_src/M_AXIS', 'stream_sink/S_AXIS');
    expect(crossing).toMatchObject({ kind: 'data', status: 'related', reason: REASON });
    expect(crossing.from.domain?.name).toBe('clk_out1');
    expect(crossing.to.domain?.name).toBe('clk_out2');
  });

  it('marks a reset released on one output and used on the other as related', () => {
    const crossing = between(
      analysis.crossings,
      'rst_clk_out2/peripheral_aresetn',
      'stream_src/aresetn'
    );
    expect(crossing).toMatchObject({ kind: 'reset', status: 'related', reason: REASON });
    expect(
      between(analysis.crossings, 'rst_clk_out2/peripheral_aresetn', 'stream_sink/aresetn').status
    ).toBe('ok');
  });

  it('accepts the PS reset on the wizard reset input as an asynchronous input', () => {
    expect(between(analysis.crossings, 'ps_cips/pl0_resetn', 'clk_wizard_0/resetn')).toMatchObject({
      status: 'ok',
      reason: 'The input accepts an asynchronous reset',
    });
  });

  it('relates the clock that feeds the generator input to its outputs', () => {
    const swapped = loadVersalClockGraph();
    // A stream from a block on the CIPS clock to a block on clk_out2.
    swapped.nets = swapped.nets.map((net) =>
      net.id === '/::clk_wizard_0_clk_out1'
        ? {
            ...net,
            endpoints: net.endpoints.filter(
              (ref) => ref.pin !== 'aclk' || ref.instance !== '/stream_src'
            ),
          }
        : net.id === '/::ps_cips_pl0_ref_clk'
          ? { ...net, endpoints: [...net.endpoints, { instance: '/stream_src', pin: 'aclk' }] }
          : net
    );
    const crossing = between(
      analyzeClocks(swapped).crossings,
      'stream_src/M_AXIS',
      'stream_sink/S_AXIS'
    );
    expect(crossing).toMatchObject({ status: 'related', reason: REASON });
  });

  it('does not relate two clocks that feed the inputs of one generator', () => {
    const inputs = script([
      cell('w', 'xilinx.com:ip:clk_wiz:6.0'),
      cell('ps', 'xilinx.com:ip:processing_system7:5.5'),
      cell('ps2', 'xilinx.com:ip:processing_system7:5.5'),
      blk('a'),
      blk('b'),
      'connect_bd_intf_net -intf_net n [get_bd_intf_pins a/M_AXIS] [get_bd_intf_pins b/S_AXIS]',
      'connect_bd_net -net c1 [get_bd_pins ps/FCLK_CLK0] [get_bd_pins w/clk_in1] [get_bd_pins a/clk]',
      'connect_bd_net -net c2 [get_bd_pins ps2/FCLK_CLK0] [get_bd_pins w/clk_in2] [get_bd_pins b/clk]',
    ]);
    expect(between(analyzeClocks(inputs).crossings, 'a/M_AXIS', 'b/S_AXIS').status).toBe('cross');
  });

  it('does not relate the clocks of a PS', () => {
    const ps = script([
      cell('ps', 'xilinx.com:ip:processing_system7:5.5'),
      blk('a'),
      blk('b'),
      'connect_bd_intf_net -intf_net n [get_bd_intf_pins a/M_AXIS] [get_bd_intf_pins b/S_AXIS]',
      'connect_bd_net -net c0 [get_bd_pins ps/FCLK_CLK0] [get_bd_pins a/clk]',
      'connect_bd_net -net c1 [get_bd_pins ps/FCLK_CLK1] [get_bd_pins b/clk]',
    ]);
    expect(between(analyzeClocks(ps).crossings, 'a/M_AXIS', 'b/S_AXIS').status).toBe('cross');
  });

  it('finds nothing in the Versal platform that needs a synchronizer', () => {
    expect(analysis.crossings.filter((x) => x.status === 'cross')).toEqual([]);
  });
});

describe('status order with related clocks', () => {
  const mixed = script([
    cell('w', 'xilinx.com:ip:clk_wiz:6.0'),
    cell('ps', 'xilinx.com:ip:processing_system7:5.5'),
    blk('a'),
    blk('b'),
    blk('d'),
    blk('f'),
    blk('g'),
    blk('c'),
    'connect_bd_intf_net -intf_net n1 [get_bd_intf_pins a/M_AXIS] [get_bd_intf_pins b/S_AXIS]',
    'connect_bd_intf_net -intf_net n2 [get_bd_intf_pins b/M_AXIS] [get_bd_intf_pins d/S_AXIS]',
    'connect_bd_intf_net -intf_net n3 [get_bd_intf_pins f/M_AXIS] [get_bd_intf_pins g/S_AXIS]',
    'connect_bd_intf_net -intf_net n4 [get_bd_intf_pins f/M2_AXIS] [get_bd_intf_pins c/S_AXIS]',
    'connect_bd_net -net co1 [get_bd_pins w/clk_out1] [get_bd_pins a/clk] [get_bd_pins f/clk] [get_bd_pins g/clk] [get_bd_pins c/clk]',
    'connect_bd_net -net co2 [get_bd_pins w/clk_out2] [get_bd_pins b/clk]',
    'connect_bd_net -net pc0 [get_bd_pins ps/FCLK_CLK0] [get_bd_pins d/clk] [get_bd_pins c/clk2]',
  ]);
  const analysis = analyzeClocks(mixed);

  it('lists cross, related, inside, unchecked, then ok', () => {
    expect(analysis.crossings.map((x) => x.status)).toEqual([
      'cross',
      'related',
      'inside',
      'unchecked',
      'ok',
    ]);
    expect(analysis.crossings.map((x) => x.kind)).toEqual([
      'data',
      'data',
      'block',
      'data',
      'data',
    ]);
  });

  it('counts related crossings apart from flagged ones', () => {
    expect(crossingCounts(analysis.crossings)).toEqual({
      cross: 1,
      related: 1,
      inside: 1,
      unchecked: 1,
      ok: 1,
    });
  });
});

describe('related crossings are no CDC or RDC', () => {
  const graph = loadVersalClockGraph();
  const analysis = analyzeClocks(graph);

  it('leaves the toolbar count at the number of domains', () => {
    expect(toolbarSummary(analysis)).toEqual({ text: '3', warning: false });
  });

  it('marks no pin, wire or node as a crossing', () => {
    expect(crossingEndKeys(analysis.crossings).size).toBe(0);
    expect(crossingsWithin(analysis.crossings, '/')).toEqual({ data: 0, reset: 0 });
    expect(outlineDomains(analysis, graph, '/stream_src').crossings).toBe(0);
    const edges = graph.nets.map((net) => ({ id: `${net.id}#0`, data: { netId: net.id } }));
    expect(crossingEdgeIds(graph, edges, analysis.crossings).size).toBe(0);
  });
});
