import { renderHook } from '@testing-library/react';
import { useDiagramViewport } from '../../../../webview/systemDiagram/hooks/useDiagramViewport';
import type { RevealRequest } from '../../../../webview/systemDiagram/model';
import type { DiagramLayout } from '../../../../webview/systemDiagram/hooks/useElkLayout';

const mockSetCenter = jest.fn<void, [number, number, { zoom: number }]>();
const mockSetViewport = jest.fn();
const mockViewport = { x: 0, y: 0, zoom: 1.5 };

jest.mock('@xyflow/react', () => ({
  // A node larger than the canvas: it fits at zoom 0.4.
  getViewportForBounds: () => ({ x: 0, y: 0, zoom: 0.4 }),
  useReactFlow: () => ({
    fitBounds: jest.fn(),
    getViewport: () => mockViewport,
    setViewport: mockSetViewport,
    setCenter: mockSetCenter,
  }),
  useStoreApi: () => ({
    getState: () => ({ width: 1000, height: 800, minZoom: 0.05, maxZoom: 2 }),
  }),
}));

const layout = {
  levelPath: '/',
  viewKey: '/',
  nodes: [
    {
      id: '/big',
      type: 'frame',
      position: { x: 0, y: 0 },
      width: 4000,
      height: 3000,
      data: { west: [], east: [] },
    },
  ],
  edges: [],
} as unknown as DiagramLayout;

describe('useDiagramViewport reveal zoom', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(0);
      return 0;
    });
  });
  afterEach(() => jest.restoreAllMocks());

  const reveal = (zoom: RevealRequest['zoom']): RevealRequest => ({
    token: 1,
    selection: { kind: 'instance', id: '/big' },
    levelPath: '/',
    zoom,
  });
  const run = (zoom: RevealRequest['zoom']) => {
    const { result } = renderHook(() => useDiagramViewport(layout, 'r', reveal(zoom)));
    return result;
  };

  it('zooms out to the fit zoom for a whole reveal of a node larger than the canvas', () => {
    run('whole');
    expect(mockSetCenter).toHaveBeenCalledWith(2000, 1500, { zoom: 0.4 });
  });

  it('keeps the current zoom for a readable reveal in the same situation', () => {
    run('readable');
    expect(mockSetCenter).toHaveBeenCalledWith(2000, 1500, { zoom: 1.5 });
  });

  it('zooms out for a whole reveal on a level whose viewport is restored', () => {
    const other: DiagramLayout = { ...layout, levelPath: '/other', viewKey: '/other' };
    const { rerender } = renderHook(
      ({ shown, request }: { shown: DiagramLayout; request: RevealRequest | null }) =>
        useDiagramViewport(shown, 'r', request),
      { initialProps: { shown: layout, request: null as RevealRequest | null } }
    );
    // Leaving the level saves its viewport; coming back restores it and then reveals.
    rerender({ shown: other, request: null });
    expect(mockSetCenter).not.toHaveBeenCalled();
    rerender({ shown: layout, request: reveal('whole') });
    expect(mockSetViewport).toHaveBeenLastCalledWith(mockViewport);
    expect(mockSetCenter).toHaveBeenCalledWith(2000, 1500, { zoom: 0.4 });
  });
});
