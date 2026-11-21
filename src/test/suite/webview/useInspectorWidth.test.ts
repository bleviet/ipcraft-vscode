import { act, renderHook } from '@testing-library/react';
import { useInspectorWidth } from '../../../webview/ipcore/components/canvas/inspector/useInspectorWidth';

const WIDTH_KEY = 'ipcraft.inspectorWidth';

function dragBy(
  result: { current: ReturnType<typeof useInspectorWidth> },
  fromX: number,
  toX: number
) {
  act(() => {
    result.current.handleResizeMouseDown({
      preventDefault: jest.fn(),
      clientX: fromX,
    } as unknown as React.MouseEvent);
  });
  act(() => {
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: toX }));
  });
  act(() => {
    document.dispatchEvent(new MouseEvent('mouseup'));
  });
}

describe('useInspectorWidth', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('defaults to 288 when nothing is stored', () => {
    const { result } = renderHook(() => useInspectorWidth());
    expect(result.current.panelWidth).toBe(288);
  });

  it('uses a stored in-range width as is', () => {
    sessionStorage.setItem(WIDTH_KEY, '250');
    const { result } = renderHook(() => useInspectorWidth());
    expect(result.current.panelWidth).toBe(250);
  });

  it('falls back to 288 for an out-of-range stored width', () => {
    sessionStorage.setItem(WIDTH_KEY, '700');
    expect(renderHook(() => useInspectorWidth()).result.current.panelWidth).toBe(288);
    sessionStorage.setItem(WIDTH_KEY, '100');
    expect(renderHook(() => useInspectorWidth()).result.current.panelWidth).toBe(288);
  });

  it('resizes by dragging, clamps to 240..640 and stores the width', () => {
    const { result } = renderHook(() => useInspectorWidth());
    dragBy(result, 800, 700);
    expect(result.current.panelWidth).toBe(388);
    expect(sessionStorage.getItem(WIDTH_KEY)).toBe('388');
    dragBy(result, 800, 0);
    expect(result.current.panelWidth).toBe(640);
    expect(sessionStorage.getItem(WIDTH_KEY)).toBe('640');
    dragBy(result, 0, 2000);
    expect(result.current.panelWidth).toBe(240);
    expect(sessionStorage.getItem(WIDTH_KEY)).toBe('240');
  });

  it('uses options.defaultWidth when nothing is stored', () => {
    const { result } = renderHook(() => useInspectorWidth({ defaultWidth: 320 }));
    expect(result.current.panelWidth).toBe(320);
  });

  it('raises a stored width to options.minInitialWidth at mount only', () => {
    sessionStorage.setItem(WIDTH_KEY, '250');
    const { result } = renderHook(() =>
      useInspectorWidth({ defaultWidth: 320, minInitialWidth: 300 })
    );
    expect(result.current.panelWidth).toBe(300);
    dragBy(result, 800, 1000);
    expect(result.current.panelWidth).toBe(240);
  });
});
