import { act, renderHook } from '@testing-library/react';
import { usePinFolding } from '../../../../webview/systemDiagram/hooks/usePinFolding';

describe('usePinFolding', () => {
  it('keeps the folding identity while nothing changes', () => {
    const { result, rerender } = renderHook(() => usePinFolding());
    const first = result.current.folding;
    expect(result.current.mode).toBe('compact');
    rerender();
    expect(result.current.folding).toBe(first);
  });

  it('changes it when a group is toggled, and to full pins in the full mode', () => {
    const { result } = renderHook(() => usePinFolding());
    const first = result.current.folding;
    act(() => result.current.togglePinGroup('/hub', 'M*_AXI|master|i'));
    const opened = result.current.folding;
    expect(opened).not.toBe(first);
    expect(opened?.open.has('/hub::M*_AXI|master|i')).toBe(true);
    act(() => result.current.togglePinGroup('/hub', 'M*_AXI|master|i'));
    expect(result.current.folding?.open.size).toBe(0);
    act(() => result.current.setMode('full'));
    expect(result.current.folding).toBeUndefined();
  });

  it('is the arch input in the arch mode, and compact again after it', () => {
    const { result } = renderHook(() => usePinFolding());
    act(() => result.current.setMode('arch'));
    expect(result.current.folding?.arch).toBe(true);
    act(() => result.current.setMode('compact'));
    expect(result.current.folding?.arch).toBeUndefined();
    expect(result.current.folding?.open.size).toBe(0);
  });
});
