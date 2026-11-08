import { act, renderHook } from '@testing-library/react';
import { DEFAULT_EXPORT_OPTIONS } from '../../../../shared/messages/imageExport';
import { useSystemDiagramMessages } from '../../../../webview/systemDiagram/hooks/useSystemDiagramMessages';
import { vscode } from '../../../../webview/vscode';

const dispatch = (data: unknown) => window.dispatchEvent(new MessageEvent('message', { data }));

describe('useSystemDiagramMessages export', () => {
  beforeEach(() => (vscode?.postMessage as jest.Mock | undefined)?.mockClear());

  it('keeps the remembered options and counts open requests without touching the state', () => {
    const { result } = renderHook(() => useSystemDiagramMessages());
    expect(result.current.imageExport.saved).toBeUndefined();

    act(() => {
      dispatch({ type: 'exportOptions', options: DEFAULT_EXPORT_OPTIONS });
    });
    act(() => {
      dispatch({ type: 'openExport' });
    });

    expect(result.current.imageExport.saved).toEqual(DEFAULT_EXPORT_OPTIONS);
    expect(result.current.imageExport.openToken).toBe(1);
    expect(result.current.state).toEqual({ status: 'loading' });
  });

  it('posts an exportImage message with the options and the view', () => {
    const { result } = renderHook(() => useSystemDiagramMessages());
    const view = { levelPath: '/', expanded: [], clocks: false, selectedNodeIds: [] };
    act(() => result.current.imageExport.send(DEFAULT_EXPORT_OPTIONS, view));
    expect(vscode?.postMessage).toHaveBeenCalledWith({
      type: 'exportImage',
      options: DEFAULT_EXPORT_OPTIONS,
      view,
    });
  });
});
