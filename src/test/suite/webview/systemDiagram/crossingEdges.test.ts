import type { SystemGraph } from '../../../../domain/systemGraph';
import { analyzeClocks } from '../../../../webview/systemDiagram/clocks/analyzeClocks';
import {
  crossingEdgeIds,
  type CrossingEdge,
} from '../../../../webview/systemDiagram/clocks/crossingEdges';
import { levelEdges } from '../../../../webview/systemDiagram/layout/levelEdges';
import { loadFeedThroughGraph, loadInnerResetGraph } from './clockTestGraphs';
import { loadClockFixtureGraph } from './fixtureGraph';

const DSP = '/dsp_pipeline';

/** Every drawn edge of every level, as the canvas hands them over (clock and reset wires shown). */
function drawnEdges(graph: SystemGraph): CrossingEdge[] {
  return Object.keys(graph.levels).flatMap((level) =>
    levelEdges(graph, level).map((edge) => ({
      id: edge.id,
      data: { netId: edge.id.slice(0, edge.id.lastIndexOf('#')) },
    }))
  );
}

describe('crossingEdgeIds on the clock fixture', () => {
  const graph = loadClockFixtureGraph();
  const analysis = analyzeClocks(graph);
  const edges = drawnEdges(graph);
  const flagged = (kind: 'data' | 'reset') =>
    crossingEdgeIds(
      graph,
      edges,
      analysis.crossings.filter((crossing) => crossing.kind === kind)
    );

  it('marks every edge of the nets of a data crossing, across the hierarchy', () => {
    expect([...flagged('data')].sort()).toEqual([
      '/::dsp_pipeline_M_AXIS#0',
      `${DSP}::Conn2#0`,
      `${DSP}::fir_ctrl_0_M_AXIS_CONFIG#1`,
    ]);
  });

  it('marks only the path from the reset source to the failing sink', () => {
    expect([...flagged('reset')].sort()).toEqual([
      '/::rst_ps7_0_100M_peripheral_aresetn#3',
      `${DSP}::aresetn_1#3`,
      `${DSP}::aresetn_1#4`,
    ]);
  });

  it('leaves the wires to ok and unchecked sinks of the same reset unmarked', () => {
    const marked = crossingEdgeIds(graph, edges, analysis.crossings);
    // #1 is the interconnect and #2 the DMA at the root; #1 the FIFO and #2 the control block inside.
    for (const id of [
      '/::rst_ps7_0_100M_peripheral_aresetn#1',
      '/::rst_ps7_0_100M_peripheral_aresetn#2',
      `${DSP}::aresetn_1#1`,
      `${DSP}::aresetn_1#2`,
    ]) {
      expect(marked.has(id)).toBe(false);
    }
    expect(marked.size).toBe(6);
  });

  it('marks nothing for unflagged crossings, blocks, or edges of nets nobody flagged', () => {
    const unflagged = analysis.crossings.filter((crossing) => crossing.status !== 'cross');
    expect(crossingEdgeIds(graph, edges, unflagged).size).toBe(0);
    expect(crossingEdgeIds(graph, [], analysis.crossings).size).toBe(0);
    const stranger: CrossingEdge = { id: 'nope::x#0', data: { netId: 'nope::x' } };
    expect(crossingEdgeIds(graph, [stranger], analysis.crossings).size).toBe(0);
  });
});

describe('crossingEdgeIds for a reset generated inside a hierarchy', () => {
  const graph = loadInnerResetGraph();
  const analysis = analyzeClocks(graph);

  it('flags the reset used on another clock at the root', () => {
    const flagged = analysis.crossings.filter((x) => x.status === 'cross');
    expect(
      flagged.map((x) => (x.kind === 'block' ? x.instance : `${x.from.label} -> ${x.to.label}`))
    ).toEqual(['r/peripheral_aresetn -> b/rst_n']);
  });

  it('follows the reset out of the hierarchy through its boundary pin, not to the block inside', () => {
    const marked = crossingEdgeIds(graph, drawnEdges(graph), analysis.crossings);
    // r_out: [r/peripheral_aresetn, rst_out boundary pin, r2/rst_n]; the boundary pin leads out of /h.
    expect([...marked].sort()).toEqual(['/::h_rst#1', '/h::r_out#1']);
  });
});

describe('crossingEdgeIds for a stream that only passes through a hierarchy', () => {
  it('marks the wire in and out of the hierarchy and the one across it', () => {
    const graph = loadFeedThroughGraph();
    const analysis = analyzeClocks(graph);
    const marked = crossingEdgeIds(graph, drawnEdges(graph), analysis.crossings);
    expect([...marked].sort()).toEqual(['/::a_to_h#1', '/::h_to_b#1', '/h::feed#1']);
  });
});

describe('crossingEdgeIds for a reset that ends at an external port', () => {
  it('marks the wire to the port, which is the sink', () => {
    const graph = loadClockFixtureGraph();
    const clockPort = graph.levels['/'].boundaryPins.find((pin) => pin.name === 'ext_clk')!;
    clockPort.parameters['CONFIG.ASSOCIATED_RESET'] = 'ext_resetn:reset_out';
    graph.levels['/'].boundaryPins.push({
      name: 'reset_out',
      isInterface: false,
      direction: 'out',
      directionSource: 'declared',
      signalType: 'rst',
      parameters: {},
    });
    graph.nets
      .find((net) => net.id === '/::rst_ps7_0_100M_peripheral_aresetn')!
      .endpoints.push({ instance: null, pin: 'reset_out' });
    const analysis = analyzeClocks(graph);
    const crossing = analysis.crossings.find(
      (x) => x.kind === 'reset' && x.to.label === 'reset_out'
    );
    expect(crossing).toMatchObject({ status: 'cross', level: '/' });
    const marked = crossingEdgeIds(graph, drawnEdges(graph), [crossing!]);
    expect([...marked]).toEqual(['/::rst_ps7_0_100M_peripheral_aresetn#4']);
  });
});
