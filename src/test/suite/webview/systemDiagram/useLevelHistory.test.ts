import { act, renderHook } from '@testing-library/react';
import type { SystemGraph } from '../../../../domain/systemGraph';
import { useLevelHistory } from '../../../../webview/systemDiagram/hooks/useLevelHistory';

const graphWith = (...levels: string[]) =>
  ({ levels: Object.fromEntries(levels.map((path) => [path, {}])) }) as unknown as SystemGraph;

function setup(start: string, graph: SystemGraph) {
  const navigate = jest.fn();
  let props = { graph, levelPath: start };
  const hook = renderHook(
    (current) => useLevelHistory(current.graph, current.levelPath, navigate),
    {
      initialProps: props,
    }
  );
  const show = (next: Partial<typeof props>) => {
    props = { ...props, ...next };
    hook.rerender(props);
  };
  /** Goes up from the level on show and shows the parent level. */
  const up = () => {
    act(() => hook.result.current.up());
    const parent = navigate.mock.lastCall?.[0] as string;
    show({ levelPath: parent });
    return parent;
  };
  return { hook, navigate, up, show };
}

describe('useLevelHistory', () => {
  it('goes forward to the levels up left, deepest last', () => {
    const { hook, navigate, up } = setup('/a/b', graphWith('/', '/a', '/a/b'));
    expect(up()).toBe('/a');
    expect(up()).toBe('/');
    navigate.mockClear();
    act(() => hook.result.current.forward());
    expect(navigate).toHaveBeenLastCalledWith('/a');
  });

  it('skips levels an edit removed since up left them', () => {
    const { hook, navigate, up, show } = setup('/a/b', graphWith('/', '/a', '/a/b'));
    up();
    up();
    show({ graph: graphWith('/', '/c') });
    navigate.mockClear();
    act(() => hook.result.current.forward());
    expect(navigate).not.toHaveBeenCalled();
  });
});
