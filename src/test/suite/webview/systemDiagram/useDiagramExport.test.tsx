import React from 'react';
import { act, renderHook } from '@testing-library/react';
import { ReactFlowProvider, useStoreApi } from '@xyflow/react';
import {
  useDiagramExport,
  type ImageExportChannel,
} from '../../../../webview/systemDiagram/hooks/useDiagramExport';
import type { DiagramLayout } from '../../../../webview/systemDiagram/hooks/useElkLayout';
import type { DiagramFlowNode } from '../../../../webview/systemDiagram/layout/elkLayout';
import { DEFAULT_EXPORT_OPTIONS } from '../../../../shared/messages/imageExport';

function node(id: string, x: number, y: number) {
  return {
    id,
    type: 'boundary',
    position: { x, y },
    width: 100,
    height: 50,
    data: {},
  } as unknown as DiagramFlowNode;
}

const layout: DiagramLayout = {
  levelPath: '/dsp',
  viewKey: '/dsp',
  nodes: [node('a', 0, 0), node('b', 1000, 0)],
  edges: [],
};
const state = {
  levelPath: '/dsp',
  expanded: new Set(['/dsp/fir']),
  isolation: { seedIds: ['a'], hops: 2 },
  clocksOn: true,
  selectedNodeIds: ['a'],
  marksOn: false,
};

function setup(channel: ImageExportChannel) {
  // The viewport the canvas has: pan (0, 0), zoom 1, 400 x 300 pixels.
  let setViewport: () => void = () => {};
  const Wrapper = ({ children }: { children: React.ReactNode }) => {
    function Viewport() {
      const store = useStoreApi();
      setViewport = () => store.setState({ transform: [0, 0, 1], width: 400, height: 300 });
      return null;
    }
    return (
      <ReactFlowProvider>
        <Viewport />
        {children}
      </ReactFlowProvider>
    );
  };
  const hook = renderHook(() => useDiagramExport(channel, layout, state), { wrapper: Wrapper });
  act(() => setViewport());
  return hook;
}

describe('useDiagramExport', () => {
  it('sends the whole level with the viewer state and no visible nodes', () => {
    const send = jest.fn();
    const { result } = setup({ openToken: 0, send });
    act(() => result.current.exportImage({ ...DEFAULT_EXPORT_OPTIONS, area: 'whole' }));
    expect(send).toHaveBeenCalledWith(
      { ...DEFAULT_EXPORT_OPTIONS, area: 'whole' },
      {
        levelPath: '/dsp',
        expanded: ['/dsp/fir'],
        isolate: { nodeIds: ['a'], hops: 2 },
        clocks: true,
        selectedNodeIds: ['a'],
      }
    );
  });

  it('sends marks while the comparison marks are on the canvas', () => {
    const send = jest.fn();
    const { result } = renderHook(
      () => useDiagramExport({ openToken: 0, send }, layout, { ...state, marksOn: true }),
      { wrapper: ({ children }) => <ReactFlowProvider>{children}</ReactFlowProvider> }
    );
    act(() => result.current.exportImage({ ...DEFAULT_EXPORT_OPTIONS, area: 'whole' }));
    expect(send.mock.calls[0][1]).toMatchObject({ marks: true });
  });

  it('sends the ids of the nodes in the viewport for Current view', () => {
    const send = jest.fn();
    const { result } = setup({ openToken: 0, send });
    act(() => result.current.exportImage({ ...DEFAULT_EXPORT_OPTIONS, area: 'view' }));
    expect(send.mock.calls[0][1]).toMatchObject({ visibleNodeIds: ['a'] });
  });

  it('takes the remembered options when the host sends them', () => {
    const saved = { ...DEFAULT_EXPORT_OPTIONS, format: 'svg' as const };
    const send = jest.fn();
    const { result, rerender } = setup({ openToken: 0, send });
    expect(result.current.options).toEqual(DEFAULT_EXPORT_OPTIONS);
    // A new channel object carries the options the host sent after the webview was ready.
    rerender();
    const second = renderHook(
      () => useDiagramExport({ saved, openToken: 0, send }, layout, state),
      {
        wrapper: ({ children }) => <ReactFlowProvider>{children}</ReactFlowProvider>,
      }
    );
    expect(second.result.current.options).toEqual(saved);
  });
});
