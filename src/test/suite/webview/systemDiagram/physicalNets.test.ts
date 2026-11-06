import type { PinRef } from '../../../../domain/systemGraph';
import { buildPhysicalNets, endKey } from '../../../../webview/systemDiagram/clocks/physicalNets';
import { loadFeedThroughGraph } from './clockTestGraphs';
import { loadClockFixtureGraph, loadQsysFixtureGraph } from './fixtureGraph';

const DSP = '/dsp_pipeline';
const inst = (instance: string, pin: string): PinRef => ({ instance, pin });
const port = (pin: string): PinRef => ({ instance: null, pin });
const ends = (net: { ends: { level: string; instance: string | null; pin: string }[] }) =>
  net.ends.map((end) => `${end.level}|${end.instance ?? ''}::${end.pin}`);

describe('buildPhysicalNets on the clock fixture', () => {
  const graph = loadClockFixtureGraph();
  const physical = buildPhysicalNets(graph);

  it('joins the nets on both sides of a hierarchy pin', () => {
    const outer = physical.ofNet('/::processing_system7_0_FCLK_CLK1');
    expect(outer).toBeDefined();
    expect(physical.ofNet(`${DSP}::dsp_clk_1`)).toBe(outer);
    expect(outer?.nets.map((net) => net.id)).toEqual([
      `${DSP}::dsp_clk_1`,
      '/::processing_system7_0_FCLK_CLK1',
    ]);
  });

  it('treats a hierarchy instance pin and the boundary pin inside as one occurrence', () => {
    const outside = physical.ofPin('/', inst(DSP, 'dsp_clk'));
    expect(outside).toBeDefined();
    expect(physical.ofPin(DSP, port('dsp_clk'))).toBe(outside);
  });

  it('keeps leaf pins and root ports as ends, never hierarchy pins', () => {
    const net = physical.ofNet('/::processing_system7_0_FCLK_CLK1')!;
    expect(ends(net)).toEqual([
      `${DSP}|${DSP}/axis_data_fifo_0::m_axis_aclk`,
      `${DSP}|${DSP}/fir_compiler_0::aclk`,
      `${DSP}|${DSP}/ovf_monitor_0::clk`,
      '/|/processing_system7_0::FCLK_CLK1',
    ]);
    const external = physical.ofNet('/::ext_clk_1')!;
    expect(ends(external)).toEqual(['/|::ext_clk', '/|/ext_fifo_0::s_axis_aclk']);
  });

  it('takes the driver from the first member net whose driver is an end', () => {
    const clock = physical.ofNet(`${DSP}::dsp_clk_1`)!;
    expect(clock.driver).toEqual({
      level: '/',
      instance: '/processing_system7_0',
      pin: 'FCLK_CLK1',
    });
    expect(clock.driverNet?.id).toBe('/::processing_system7_0_FCLK_CLK1');
    // Inside the hierarchy the driver of Conn1 is the boundary pin, which is only pass-through.
    const stream = physical.ofNet(`${DSP}::Conn1`)!;
    expect(stream.driver).toEqual({ level: '/', instance: '/axi_dma_0', pin: 'M_AXIS_MM2S' });
    expect(ends(stream)).toEqual([
      `${DSP}|${DSP}/axis_data_fifo_0::S_AXIS`,
      '/|/axi_dma_0::M_AXIS_MM2S',
    ]);
  });

  it('orders the physical nets by the script order of their driver nets', () => {
    expect(physical.nets.map((net) => net.id)).toEqual(physical.nets.map((_net, i) => `p${i}`));
    const driverNets = physical.nets.map((net) => (net.driverNet ?? net.nets[0]).id);
    const order = graph.nets.map((net) => net.id);
    expect(driverNets.map((id) => order.indexOf(id))).toEqual(
      [...driverNets.map((id) => order.indexOf(id))].sort((a, b) => a - b)
    );
  });

  it('has no physical net for a pin no net touches', () => {
    expect(physical.ofPin('/', inst('/axi_dma_0', 'M_AXI_MM2S'))).toBeUndefined();
    expect(physical.ofNet('/::nope')).toBeUndefined();
  });

  it('gives every net exactly one physical net', () => {
    const members = physical.nets.flatMap((net) => net.nets.map((member) => member.id));
    expect(members.sort()).toEqual(graph.nets.map((net) => net.id).sort());
  });

  it('keys an end by level, instance and pin', () => {
    expect(endKey({ level: DSP, instance: null, pin: 'aclk' })).toBe(`${DSP}|::aclk`);
  });
});

describe('buildPhysicalNets through a hierarchy that only passes a net on', () => {
  const graph = loadFeedThroughGraph();
  const physical = buildPhysicalNets(graph);

  it('joins the two root nets and the net inside into one', () => {
    const net = physical.ofNet('/::a_to_h')!;
    expect(physical.ofNet('/h::feed')).toBe(net);
    expect(physical.ofNet('/::h_to_b')).toBe(net);
    expect(net.nets.map((member) => member.id)).toEqual(['/h::feed', '/::h_to_b', '/::a_to_h']);
  });

  it('has the blocks on both sides as ends and the first block as driver', () => {
    const net = physical.ofNet('/::a_to_h')!;
    expect(ends(net)).toEqual(['/|/b::S_AXIS', '/|/a::M_AXIS']);
    expect(net.driver).toEqual({ level: '/', instance: '/a', pin: 'M_AXIS' });
    expect(net.driverNet?.id).toBe('/::a_to_h');
  });
});

describe('buildPhysicalNets.ofPin for a hierarchy pin with a net on one side only', () => {
  it('resolves an inner boundary pin without an inner net to the outer net', () => {
    const graph = loadClockFixtureGraph();
    graph.nets = graph.nets.filter((net) => net.id !== `${DSP}::Conn3`);
    const physical = buildPhysicalNets(graph);
    expect(physical.ofNet(`${DSP}::Conn3`)).toBeUndefined();
    const outer = physical.ofNet('/::ps7_0_axi_periph_M01_AXI');
    expect(outer).toBeDefined();
    expect(physical.ofPin(DSP, port('S_AXI_CTRL'))).toBe(outer);
    expect(physical.ofPin('/', inst(DSP, 'S_AXI_CTRL'))).toBe(outer);
  });

  it('resolves a hierarchy instance pin without an outer net to the inner net', () => {
    const graph = loadClockFixtureGraph();
    graph.nets = graph.nets.filter((net) => net.id !== '/::axi_dma_0_M_AXIS_MM2S');
    const physical = buildPhysicalNets(graph);
    expect(physical.ofPin('/', inst(DSP, 'S_AXIS'))).toBe(physical.ofNet(`${DSP}::Conn1`));
  });

  it('keeps a pin that no net touches on either side unresolved', () => {
    const graph = loadClockFixtureGraph();
    graph.nets = graph.nets.filter(
      (net) => net.id !== `${DSP}::Conn3` && net.id !== '/::ps7_0_axi_periph_M01_AXI'
    );
    const physical = buildPhysicalNets(graph);
    expect(physical.ofPin(DSP, port('S_AXI_CTRL'))).toBeUndefined();
    expect(physical.ofPin('/', inst(DSP, 'S_AXI_CTRL'))).toBeUndefined();
  });
});

describe('buildPhysicalNets on a Platform Designer system', () => {
  it('keeps nets that share a sink pin apart: a pin can have two drivers', () => {
    const physical = buildPhysicalNets(loadQsysFixtureGraph());
    const first = physical.ofNet('/::clk_0.clk_reset')!;
    const second = physical.ofNet('/::nios2_gen2_0.debug_reset_request')!;
    expect(first).not.toBe(second);
    expect(ends(first)).toContain('/|/jtag_uart_0::reset');
    expect(ends(second)).toContain('/|/jtag_uart_0::reset');
    expect(first.driver?.pin).toBe('clk_reset');
    expect(second.driver?.pin).toBe('debug_reset_request');
  });
});
