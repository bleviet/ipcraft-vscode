import { act, renderHook } from '@testing-library/react';
import { usePinFolding } from '../../../../webview/systemDiagram/hooks/usePinFolding';

describe('usePinFolding', () => {
  it('keeps the folding identity while nothing changes', () => {
    const { result, rerender } = renderHook(() => usePinFolding());
    const first = result.current.folding;
    expect(result.current.compact).toBe(true);
    rerender();
    expect(result.current.folding).toBe(first);
  });

  it('changes it when a group is toggled, and back to full pins when compact is off', () => {
    const { result } = renderHook(() => usePinFolding());
    const first = result.current.folding;
    act(() => result.current.togglePinGroup('/hub', 'M*_AXI|master|i'));
    const opened = result.current.folding;
    expect(opened).not.toBe(first);
    expect(opened?.open.has('/hub::M*_AXI|master|i')).toBe(true);
    act(() => result.current.togglePinGroup('/hub', 'M*_AXI|master|i'));
    expect(result.current.folding?.open.size).toBe(0);
    act(() => result.current.setCompact(false));
    expect(result.current.folding).toBeUndefined();
  });
});
