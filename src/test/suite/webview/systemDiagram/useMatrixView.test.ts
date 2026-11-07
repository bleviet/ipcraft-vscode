import { act, renderHook } from '@testing-library/react';
import { useMatrixView } from '../../../../webview/systemDiagram/hooks/useMatrixView';

describe('useMatrixView', () => {
  it('toggles, closes, and closes on leaving the level', () => {
    const { result, rerender } = renderHook(({ level }) => useMatrixView(level), {
      initialProps: { level: '/' },
    });
    expect(result.current.open).toBe(false);
    act(() => result.current.toggle());
    expect(result.current.open).toBe(true);
    rerender({ level: '/sub' });
    expect(result.current.open).toBe(false);
    rerender({ level: '/' });
    expect(result.current.open).toBe(false);
    act(() => result.current.toggle());
    act(() => result.current.close());
    expect(result.current.open).toBe(false);
  });
});
