import { act, renderHook } from '@testing-library/react';
import type { SystemGraph } from '../../../../domain/systemGraph';
import { useIsolation } from '../../../../webview/systemDiagram/hooks/useIsolation';
import { archGraph } from './archGraph';

// The end rules of a pair isolation: Show All, a vanished node, and a reveal of a hidden node.
const nav = () => ({
  levelPath: '/',
  expanded: new Set<string>(),
  selectAndReveal: jest.fn(),
  revealMatch: jest.fn(),
  selectInstance: jest.fn(),
});

function setup(graph: SystemGraph = archGraph()) {
  const navigation = nav();
  const hook = renderHook(({ g }) => useIsolation(g, navigation), { initialProps: { g: graph } });
  act(() => hook.result.current.isolatePair('/src', '/dst'));
  return { ...hook, navigation };
}

describe('a pair isolation', () => {
  it('shows the pair and its edges', () => {
    const { result } = setup();
    expect(result.current.isolation?.pair).toEqual({ a: '/src', b: '/dst' });
    expect([...result.current.isolation!.nodeIds].sort()).toEqual(['/dst', '/src']);
  });

  it('ends on Show All', () => {
    const { result } = setup();
    act(() => result.current.showAll());
    expect(result.current.isolation).toBeNull();
  });

  it('ends when one of its nodes vanishes from the graph', () => {
    const graph = archGraph();
    const { result, rerender } = setup(graph);
    const { '/dst': _gone, ...instances } = graph.instances;
    rerender({
      g: {
        ...graph,
        instances,
        levels: { ...graph.levels, '/': { ...graph.levels['/'], instances: ['/src', '/sub'] } },
      },
    });
    expect(result.current.isolation).toBeNull();
  });

  it('ends when a reveal targets a block it hides, and the reveal goes on', () => {
    const { result, navigation } = setup();
    act(() => result.current.selectInstance('/sub'));
    expect(result.current.isolation).toBeNull();
    expect(navigation.selectInstance).toHaveBeenCalledWith('/sub');
  });

  it('stays when a reveal targets one of its blocks', () => {
    const { result } = setup();
    act(() => result.current.selectInstance('/dst'));
    expect(result.current.isolation).not.toBeNull();
  });
});
