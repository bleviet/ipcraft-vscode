import type { SystemGraph } from '../../../../domain/systemGraph';
import { analyzeClocks } from '../../../../webview/systemDiagram/clocks/analyzeClocks';
import {
  crossingEdgeIds,
  type CrossingEdge,
} from '../../../../webview/systemDiagram/clocks/crossingEdges';
import { levelEdges } from '../../../../webview/systemDiagram/layout/levelEdges';
import { loadFeedThroughGraph } from './clockTestGraphs';
import { loadClockFixtureGraph } from './fixtureGraph';

const DSP = '/dsp_pipeline';

/** Every edge of every level, clock and reset nets included, so a reset crossing could mark one. */
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

  it('marks no wire for a reset crossing, which shows on its sink pin', () => {
    expect(analysis.crossings.some((x) => x.kind === 'reset' && x.status === 'cross')).toBe(true);
    expect(flagged('reset').size).toBe(0);
    expect(crossingEdgeIds(edges, analysis.crossings)).toEqual(flagged('data'));
  });

  it('marks nothing for unflagged crossings, blocks, or edges of nets nobody flagged', () => {
    const unflagged = analysis.crossings.filter((crossing) => crossing.status !== 'cross');
    expect(crossingEdgeIds(edges, unflagged).size).toBe(0);
    expect(crossingEdgeIds([], analysis.crossings).size).toBe(0);
    const stranger: CrossingEdge = { id: 'nope::x#0', data: { netId: 'nope::x' } };
    expect(crossingEdgeIds([stranger], analysis.crossings).size).toBe(0);
  });
});

describe('crossingEdgeIds for a stream that only passes through a hierarchy', () => {
  it('marks the wire in and out of the hierarchy and the one across it', () => {
    const graph = loadFeedThroughGraph();
    const analysis = analyzeClocks(graph);
    const marked = crossingEdgeIds(drawnEdges(graph), analysis.crossings);
    expect([...marked].sort()).toEqual(['/::a_to_h#1', '/::h_to_b#1', '/h::feed#1']);
  });
});
