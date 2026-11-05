import {
  reduceDiagramMessage,
  type SystemDiagramState,
} from '../../../../webview/systemDiagram/messageState';
import { loadFixtureGraph } from './fixtureGraph';

const graph = loadFixtureGraph();
const loading: SystemDiagramState = { status: 'loading' };

describe('reduceDiagramMessage', () => {
  it('shows empty states when no graph was shown yet', () => {
    expect(reduceDiagramMessage(loading, { type: 'error', message: 'boom' })).toEqual({
      status: 'error',
      message: 'boom',
    });
    expect(reduceDiagramMessage(loading, { type: 'notRecognized', fileName: 'a.tcl' })).toEqual({
      status: 'notRecognized',
      fileName: 'a.tcl',
    });
  });

  it('keeps the last graph and records the problem once a graph was shown', () => {
    const shown = reduceDiagramMessage(loading, { type: 'graph', graph });
    const broken = reduceDiagramMessage(shown, { type: 'error', message: 'boom' });
    expect(broken).toEqual({ status: 'graph', graph, problem: { kind: 'error', message: 'boom' } });
    const unrecognized = reduceDiagramMessage(broken, { type: 'notRecognized', fileName: 'a.tcl' });
    expect(unrecognized).toEqual({
      status: 'graph',
      graph,
      problem: { kind: 'notRecognized' },
    });
  });

  it('replaces the graph and clears the problem on the next graph message', () => {
    const broken = reduceDiagramMessage(reduceDiagramMessage(loading, { type: 'graph', graph }), {
      type: 'error',
      message: 'boom',
    });
    const next = { ...graph, name: 'renamed' };
    expect(reduceDiagramMessage(broken, { type: 'graph', graph: next })).toEqual({
      status: 'graph',
      graph: next,
    });
  });
});
