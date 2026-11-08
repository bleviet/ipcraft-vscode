import { act, renderHook } from '@testing-library/react';
import { DEFAULT_EXPORT_OPTIONS } from '../../../shared/messages/imageExport';
import { useIpCoreExport } from '../../../webview/ipcore/hooks/useIpCoreExport';
import { vscode } from '../../../webview/vscode';

describe('useIpCoreExport', () => {
  beforeEach(() => (vscode?.postMessage as jest.Mock | undefined)?.mockClear());

  it('sends the visible rectangle of the canvas for Current view', () => {
    const { result } = renderHook(() => useIpCoreExport());
    const rect = { x: 10, y: 20, width: 300, height: 200 };
    result.current.visibleRectRef.current = () => ({ rect, bundlesExpanded: false });
    act(() => result.current.exportImage({ ...DEFAULT_EXPORT_OPTIONS, area: 'view' }));
    expect(vscode?.postMessage).toHaveBeenCalledWith({
      type: 'exportImage',
      options: { ...DEFAULT_EXPORT_OPTIONS, area: 'view' },
      view: { visibleRect: rect, bundlesExpanded: false },
    });
  });

  it('tells the host that a bus bundle is expanded', () => {
    const { result } = renderHook(() => useIpCoreExport());
    const rect = { x: 0, y: 0, width: 5, height: 5 };
    result.current.visibleRectRef.current = () => ({ rect, bundlesExpanded: true });
    act(() => result.current.exportImage({ ...DEFAULT_EXPORT_OPTIONS, area: 'view' }));
    expect(vscode?.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ view: { visibleRect: rect, bundlesExpanded: true } })
    );
  });

  it('sends no rectangle for the whole diagram', () => {
    const { result } = renderHook(() => useIpCoreExport());
    result.current.visibleRectRef.current = () => ({
      rect: { x: 0, y: 0, width: 1, height: 1 },
      bundlesExpanded: false,
    });
    act(() => result.current.exportImage({ ...DEFAULT_EXPORT_OPTIONS, area: 'whole' }));
    expect(vscode?.postMessage).toHaveBeenCalledWith({
      type: 'exportImage',
      options: { ...DEFAULT_EXPORT_OPTIONS, area: 'whole' },
      view: {},
    });
  });

  it('counts open requests and stores the options the host remembered', () => {
    const { result } = renderHook(() => useIpCoreExport());
    act(() => result.current.requestOpen());
    expect(result.current.openToken).toBe(1);
    act(() => result.current.setOptions({ ...DEFAULT_EXPORT_OPTIONS, theme: 'dark' }));
    expect(result.current.options.theme).toBe('dark');
  });
});
