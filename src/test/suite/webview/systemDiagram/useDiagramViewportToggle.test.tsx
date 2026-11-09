import { renderHook } from '@testing-library/react';
import { useDiagramViewport } from '../../../../webview/systemDiagram/hooks/useDiagramViewport';
import type { RevealRequest } from '../../../../webview/systemDiagram/model';
import type { DiagramLayout } from '../../../../webview/systemDiagram/hooks/useElkLayout';

const mockSetViewport = jest.fn<void, [{ x: number; y: number; zoom: number }]>();
const mockFitBounds = jest.fn();
const mockViewport = { x: 30, y: -40, zoom: 0.5 };

jest.mock('@xyflow/react', () => ({
  getViewportForBounds: jest.fn(),
  useReactFlow: () => ({
    fitBounds: mockFitBounds,
    getViewport: () => mockViewport,
    setViewport: mockSetViewport,
    setCenter: jest.fn(),
  }),
  useStoreApi: () => ({ getState: () => ({}) }),
}));

type Kind = 'instance' | 'frame';

function layoutOf(kind: Kind, at: { x: number; y: number }, viewKey = '/'): DiagramLayout {
  const nodes = [
    {
      id: '/a',
      type: 'instance',
      position: { x: 0, y: 0 },
      width: 10,
      height: 10,
      data: { west: [], east: [] },
    },
    { id: '/dsp', type: kind, position: at, width: 10, height: 10, data: { west: [], east: [] } },
  ];
  return { levelPath: '/', viewKey, nodes, edges: [] } as unknown as DiagramLayout;
}

const screenOf = (v: typeof mockViewport, p: { x: number; y: number }) => ({
  x: p.x * v.zoom + v.x,
  y: p.y * v.zoom + v.y,
});

describe('useDiagramViewport toggle anchoring', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 0);
  });
  afterEach(() => jest.restoreAllMocks());

  function setup(first: DiagramLayout) {
    return renderHook(({ layout, reveal }) => useDiagramViewport(layout, 'r', reveal), {
      initialProps: { layout: first, reveal: null as RevealRequest | null },
    });
  }

  it('keeps the block at the same screen point when it expands and collapses', () => {
    const collapsed = layoutOf('instance', { x: 100, y: 60 });
    const expanded = layoutOf('frame', { x: 260, y: 20 });
    const view = setup(collapsed);
    expect(mockSetViewport).not.toHaveBeenCalled();

    view.rerender({ layout: expanded, reveal: null });
    expect(mockSetViewport).toHaveBeenCalledTimes(1);
    expect(screenOf(mockSetViewport.mock.calls[0][0], { x: 260, y: 20 })).toEqual(
      screenOf(mockViewport, { x: 100, y: 60 })
    );

    view.rerender({ layout: collapsed, reveal: null });
    expect(mockSetViewport).toHaveBeenCalledTimes(2);
    expect(screenOf(mockSetViewport.mock.calls[1][0], { x: 100, y: 60 })).toEqual(
      screenOf(mockViewport, { x: 260, y: 20 })
    );
  });

  it('does not move the viewport on a re-layout without a toggle', () => {
    const view = setup(layoutOf('instance', { x: 100, y: 60 }));
    view.rerender({ layout: layoutOf('instance', { x: 140, y: 80 }), reveal: null });
    expect(mockSetViewport).not.toHaveBeenCalled();
  });

  it('does not anchor when the toggle arrives with a handled reveal request', () => {
    const view = setup(layoutOf('instance', { x: 100, y: 60 }));
    const reveal: RevealRequest = {
      token: 1,
      selection: { kind: 'instance', id: '/a' },
      levelPath: '/',
    };
    view.rerender({ layout: layoutOf('frame', { x: 260, y: 20 }), reveal });
    expect(mockSetViewport).not.toHaveBeenCalled();
  });

  it('does not anchor when the toggled layout belongs to another view', () => {
    const view = setup(layoutOf('instance', { x: 100, y: 60 }));
    view.rerender({
      layout: layoutOf('frame', { x: 260, y: 20 }, '/#isolate:1'),
      reveal: null,
    });
    expect(mockSetViewport).not.toHaveBeenCalled();
    expect(window.requestAnimationFrame).toHaveBeenCalled();
  });
});
