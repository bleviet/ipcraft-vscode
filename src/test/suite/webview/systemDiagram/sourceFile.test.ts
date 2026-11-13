import { levelSource, segmentLevel } from '../../../../webview/systemDiagram/sourceFile';
import type { AddressSegment, SystemGraph } from '../../../../domain/systemGraph';
import { loadFixtureGraph } from './fixtureGraph';

const fixtureGraph = loadFixtureGraph();

describe('sourceFile', () => {
  const graph: SystemGraph = {
    ...fixtureGraph,
    levels: {
      ...fixtureGraph.levels,
      '/sub': {
        path: '/sub',
        name: 'sub',
        boundaryPins: [],
        instances: [],
        source: { fileName: 'lib/sub.qsys', uri: 'file:///ws/lib/sub.qsys' },
      },
    },
    instances: {
      '/sub/m': { ...Object.values(fixtureGraph.instances)[0], path: '/sub/m', parent: '/sub' },
    },
  };

  it('falls back to the graph document for a level without a source', () => {
    expect(levelSource(graph, '/')).toEqual({ fileName: graph.source.fileName });
    expect(levelSource(graph, '/missing')).toEqual({ fileName: graph.source.fileName });
  });

  it('returns the file a grafted level was read from', () => {
    expect(levelSource(graph, '/sub')).toEqual({
      fileName: 'lib/sub.qsys',
      uri: 'file:///ws/lib/sub.qsys',
    });
  });

  it('resolves a segment to the parent of its master instance, or the root', () => {
    const segment = { masterInstance: '/sub/m' } as AddressSegment;
    expect(segmentLevel(graph, segment)).toBe('/sub');
    expect(segmentLevel(graph, { masterInstance: '/nope' })).toBe('/');
  });
});
