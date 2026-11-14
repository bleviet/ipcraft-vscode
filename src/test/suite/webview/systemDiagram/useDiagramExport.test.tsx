import React from 'react';
import { act, renderHook } from '@testing-library/react';
import { ReactFlowProvider, useStoreApi } from '@xyflow/react';
import {
  useDiagramExport,
  type ImageExportChannel,
} from '../../../../webview/systemDiagram/hooks/useDiagramExport';
import type { DiagramLayout } from '../../../../webview/systemDiagram/hooks/useElkLayout';
import type { DiagramFlowNode } from '../../../../webview/systemDiagram/layout/elkLayout';
import type { SystemExportState } from '../../../../webview/systemDiagram/exportView';
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

function setup(channel: ImageExportChannel, shown: DiagramLayout = layout) {
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
  const hook = renderHook(() => useDiagramExport(channel, shown, state), {
    wrapper: Wrapper,
  });
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

  it('sends ghosts only with marks and the ghosts drawn, and counts them among the nodes in view', () => {
    const send = jest.fn();
    // `ghost` is on screen with `a`: the layout holds it only while the canvas draws it.
    const withGhost = { ...layout, nodes: [node('a', 0, 0), node('ghost', 150, 0)] };
    const sent = (extra: Partial<SystemExportState>) => {
      const { result } = renderHook(
        () => useDiagramExport({ openToken: 0, send }, withGhost, { ...state, ...extra }),
        { wrapper: ({ children }) => <ReactFlowProvider>{children}</ReactFlowProvider> }
      );
      act(() => result.current.exportImage({ ...DEFAULT_EXPORT_OPTIONS, area: 'whole' }));
      return send.mock.calls.at(-1)![1] as Record<string, unknown>;
    };
    expect(sent({ marksOn: true, ghostsOn: true })).toMatchObject({ marks: true, ghosts: true });
    expect(sent({ marksOn: true })).not.toHaveProperty('ghosts');
    expect(sent({ marksOn: true, ghostsOn: false })).not.toHaveProperty('ghosts');
    // The union layout is sent whether or not the ghosts are drawn, and without a comparison it is not.
    expect(sent({ unionLayout: true })).toMatchObject({ unionLayout: true });
    expect(sent({ marksOn: true, ghostsOn: true, unionLayout: true })).toMatchObject({
      unionLayout: true,
    });
    expect(sent({ marksOn: true })).not.toHaveProperty('unionLayout');
    // Marks off hides the ghosts, so the app never sets `ghostsOn` then; the message still carries none.
    expect(sent({ marksOn: false, ghostsOn: true })).not.toHaveProperty('ghosts');
    const { result } = setup({ openToken: 0, send }, withGhost);
    act(() => result.current.exportImage({ ...DEFAULT_EXPORT_OPTIONS, area: 'view' }));
    expect(send.mock.calls.at(-1)![1]).toMatchObject({ visibleNodeIds: ['a', 'ghost'] });
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
