import {
  levelEdges,
  remapBoundaryEnds,
  type LevelEdge,
} from '../../../../webview/systemDiagram/layout/levelEdges';
import { boundaryId } from '../../../../webview/systemDiagram/model';
import { loadFixtureGraph } from './fixtureGraph';

const graph = loadFixtureGraph();
const DSP = '/dsp_pipeline';

describe('remapBoundaryEnds', () => {
  const edges = levelEdges(graph, DSP, true);

  it('re-points boundary ends at the pins of the block and leaves instance ends alone', () => {
    const remapped = remapBoundaryEnds(edges, DSP);
    const byId = (list: LevelEdge[], id: string) => list.find((edge) => edge.id === id);
    expect(byId(edges, `${DSP}::Conn1#1`)).toMatchObject({
      sourceNode: boundaryId(DSP, 'S_AXIS'),
      targetNode: `${DSP}/axis_data_fifo_0`,
    });
    expect(byId(remapped, `${DSP}::Conn1#1`)).toEqual({
      id: `${DSP}::Conn1#1`,
      sourceNode: DSP,
      sourcePin: 'S_AXIS',
      targetNode: `${DSP}/axis_data_fifo_0`,
      targetPin: 'S_AXIS',
    });
    expect(byId(remapped, `${DSP}::Conn2#0`)).toMatchObject({
      sourceNode: `${DSP}/fir_compiler_0`,
      targetNode: DSP,
      targetPin: 'M_AXIS',
    });
    expect(remapped).toHaveLength(edges.length);
  });

  it('drops an edge that starts and ends on the same port', () => {
    const loop: LevelEdge = {
      id: 'loop#0',
      sourceNode: boundaryId(DSP, 'aclk'),
      sourcePin: 'aclk',
      targetNode: DSP,
      targetPin: 'aclk',
    };
    expect(remapBoundaryEnds([loop], DSP)).toEqual([]);
  });
});
