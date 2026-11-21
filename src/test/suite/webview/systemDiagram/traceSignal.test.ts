import type { PinRef, SystemGraph, SystemPin } from '../../../../domain/systemGraph';
import { traceSignal } from '../../../../webview/systemDiagram/traceSignal';
import { loadFixtureGraph } from './fixtureGraph';

const DSP = '/dsp_pipeline';
const BANK = '/dsp_pipeline/coeff_bank';
const ROOT_NET = '/::axi_dma_0_M_AXIS_MM2S';

const pinOf = (name: string): SystemPin => ({
  name,
  isInterface: false,
  direction: 'in',
  directionSource: 'declared',
  parameters: {},
});

/** Adds pin `name` to the hierarchy `path`: the instance and its level share one pin array. */
function addPin(graph: SystemGraph, path: string, name: string): void {
  graph.levels[path].boundaryPins.push(pinOf(name));
}

const netNamed = (graph: SystemGraph, id: string) => graph.nets.find((net) => net.id === id)!;

describe('traceSignal', () => {
  it('goes to the root net and the hierarchy block that the port belongs to', () => {
    expect(traceSignal(loadFixtureGraph(), DSP, 'S_AXIS')).toEqual({
      netId: ROOT_NET,
      focus: { nodeId: DSP, pin: 'S_AXIS' },
      expand: [DSP],
    });
  });

  it('stays on the level of the port when the wire does not leave it', () => {
    const graph = loadFixtureGraph();
    graph.nets = graph.nets.filter((net) => net.id !== ROOT_NET);
    expect(traceSignal(graph, DSP, 'S_AXIS')).toEqual({
      netId: '/dsp_pipeline::Conn1',
      focus: { nodeId: '/dsp_pipeline::S_AXIS', pin: 'S_AXIS' },
      expand: [],
    });
  });

  it('has nothing to trace for a port on no net', () => {
    const graph = loadFixtureGraph();
    graph.nets = graph.nets.filter(
      (net) => net.id !== '/dsp_pipeline::Conn1' && net.id !== ROOT_NET
    );
    expect(traceSignal(graph, DSP, 'S_AXIS')).toBeUndefined();
  });

  it('traces a root-level port to its root net and the port itself', () => {
    expect(traceSignal(loadFixtureGraph(), '/', 'DDR')).toEqual({
      netId: '/::processing_system7_0_DDR',
      focus: { nodeId: '/::DDR', pin: 'DDR' },
      expand: [],
    });
  });

  it('puts the halo on the pin of the outer block when its name differs from the port', () => {
    const graph = loadFixtureGraph();
    // The port `aclk` of `coeff_bank` is renamed on both sides of its wire.
    const rename = <T extends { pin: string }>(ref: T): T =>
      ref.pin === 'aclk' ? { ...ref, pin: 'cb_clk' } : ref;
    for (const pin of graph.levels[BANK].boundaryPins) {
      if (pin.name === 'aclk') {
        pin.name = 'cb_clk';
      }
    }
    for (const net of graph.nets) {
      net.endpoints = net.endpoints.map((ref) =>
        net.level === BANK && ref.instance === null
          ? rename(ref)
          : net.level === DSP && ref.instance === BANK
            ? rename(ref)
            : ref
      );
    }
    expect(traceSignal(graph, BANK, 'cb_clk')).toEqual({
      netId: '/::processing_system7_0_FCLK_CLK0',
      focus: { nodeId: DSP, pin: 'aclk' },
      expand: [DSP, BANK],
    });
  });

  it('haloes the pin of its own port when one net touches two pins of a block', () => {
    const graph = loadFixtureGraph();
    addPin(graph, DSP, 's2');
    netNamed(graph, ROOT_NET).endpoints.push({ instance: DSP, pin: 's2' });
    netNamed(graph, '/dsp_pipeline::Conn1').endpoints.push({ instance: null, pin: 's2' });
    expect(traceSignal(graph, DSP, 'S_AXIS')?.focus).toEqual({ nodeId: DSP, pin: 'S_AXIS' });
    expect(traceSignal(graph, DSP, 's2')).toEqual({
      netId: ROOT_NET,
      focus: { nodeId: DSP, pin: 's2' },
      expand: [DSP],
    });
  });

  it('haloes the outer pin of its own path when the top net enters the outer block twice', () => {
    const graph = loadFixtureGraph();
    addPin(graph, DSP, 's2');
    addPin(graph, BANK, 'cfg1');
    addPin(graph, BANK, 'cfg2');
    netNamed(graph, ROOT_NET).endpoints.push({ instance: DSP, pin: 's2' });
    // `cfg1` hangs on the net of `S_AXIS`, `cfg2` on a net of `s2`.
    netNamed(graph, '/dsp_pipeline::Conn1').endpoints.push({ instance: BANK, pin: 'cfg1' });
    graph.nets.push({
      ...netNamed(graph, '/dsp_pipeline::Conn1'),
      id: '/dsp_pipeline::s2_net',
      name: 's2_net',
      endpoints: [
        { instance: null, pin: 's2' },
        { instance: BANK, pin: 'cfg2' },
      ],
    });
    for (const pin of ['cfg1', 'cfg2']) {
      graph.nets.push({
        ...netNamed(graph, '/dsp_pipeline::Conn1'),
        id: `${BANK}::${pin}_net`,
        name: `${pin}_net`,
        level: BANK,
        endpoints: [{ instance: null, pin }],
      });
    }
    expect(traceSignal(graph, BANK, 'cfg2')).toEqual({
      netId: ROOT_NET,
      focus: { nodeId: DSP, pin: 's2' },
      expand: [DSP, BANK],
    });
    expect(traceSignal(graph, BANK, 'cfg1')).toEqual({
      netId: ROOT_NET,
      focus: { nodeId: DSP, pin: 'S_AXIS' },
      expand: [DSP, BANK],
    });
  });

  it('stops on the middle level when its net has no boundary pin', () => {
    const graph = loadFixtureGraph();
    graph.nets = graph.nets.filter((net) => net.id !== ROOT_NET);
    addPin(graph, BANK, 'cfg1');
    // `Conn1` loses its boundary endpoint and gains the pin of `coeff_bank`.
    const conn = netNamed(graph, '/dsp_pipeline::Conn1');
    conn.endpoints = [
      { instance: `${DSP}/axis_data_fifo_0`, pin: 'S_AXIS' },
      { instance: BANK, pin: 'cfg1' },
    ];
    expect(traceSignal(graph, BANK, 'cfg1')).toEqual({
      netId: '/dsp_pipeline::Conn1',
      focus: { nodeId: BANK, pin: 'cfg1' },
      expand: [BANK],
    });
  });

  const addNet = (graph: SystemGraph, level: string, name: string, endpoints: PinRef[]) => {
    const id = `${level}::${name}`;
    graph.nets.push({ ...netNamed(graph, '/dsp_pipeline::Conn1'), id, name, level, endpoints });
    return id;
  };

  it('climbs through the boundary pin that leads up, not the first one listed', () => {
    const graph = loadFixtureGraph();
    addPin(graph, DSP, 'clk_mon');
    addPin(graph, DSP, 'clk_in');
    addPin(graph, BANK, 'clk');
    graph.nets = graph.nets.filter((net) => net.id !== ROOT_NET);
    // Inside DSP, one net: the block's pin, `clk_mon` (nothing above it), then `clk_in`.
    addNet(graph, DSP, 'clk_net', [
      { instance: BANK, pin: 'clk' },
      { instance: null, pin: 'clk_mon' },
      { instance: null, pin: 'clk_in' },
    ]);
    const root = addNet(graph, '/', 'clk_root', [{ instance: DSP, pin: 'clk_in' }]);
    addNet(graph, BANK, 'clk_inner', [{ instance: null, pin: 'clk' }]);
    expect(traceSignal(graph, BANK, 'clk')).toEqual({
      netId: root,
      focus: { nodeId: DSP, pin: 'clk_in' },
      expand: [DSP, BANK],
    });
  });

  it('takes the net of a hierarchy pin that leads up when it is not the first on the pin', () => {
    const graph = loadFixtureGraph();
    addPin(graph, DSP, 'up');
    addPin(graph, BANK, 'p');
    addNet(graph, DSP, 'low', [{ instance: BANK, pin: 'p' }]);
    addNet(graph, DSP, 'high', [
      { instance: BANK, pin: 'p' },
      { instance: null, pin: 'up' },
    ]);
    const root = addNet(graph, '/', 'above', [{ instance: DSP, pin: 'up' }]);
    expect(traceSignal(graph, BANK, 'p')).toEqual({
      netId: root,
      focus: { nodeId: DSP, pin: 'up' },
      expand: [DSP, BANK],
    });
  });

  it('does not follow a feed-through: it ends on the net of the pin it started from', () => {
    const graph = loadFixtureGraph();
    addPin(graph, BANK, 'p');
    addPin(graph, BANK, 'q');
    addPin(graph, DSP, 'up');
    const low = addNet(graph, DSP, 'p_net', [{ instance: BANK, pin: 'p' }]);
    addNet(graph, DSP, 'q_net', [
      { instance: BANK, pin: 'q' },
      { instance: null, pin: 'up' },
    ]);
    addNet(graph, '/', 'above', [{ instance: DSP, pin: 'up' }]);
    // Inside the block, `p` is wired to `q`.
    addNet(graph, BANK, 'feed', [
      { instance: null, pin: 'p' },
      { instance: null, pin: 'q' },
    ]);
    expect(traceSignal(graph, BANK, 'p')).toEqual({
      netId: low,
      focus: { nodeId: BANK, pin: 'p' },
      expand: [BANK],
    });
  });
});
