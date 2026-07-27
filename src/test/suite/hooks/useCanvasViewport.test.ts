import { act, renderHook } from '@testing-library/react';
import { useCanvasViewport } from '../../../webview/ipcore/hooks/useCanvasViewport';

describe('useCanvasViewport', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('keeps the zoom indicator visible until the shared delay after the last wheel event', () => {
    const container = document.createElement('div');
    const containerRef = { current: container };
    const { result } = renderHook(() => useCanvasViewport(containerRef));

    act(() => {
      container.dispatchEvent(new WheelEvent('wheel', { ctrlKey: true, deltaY: -100 }));
    });
    expect(result.current.showZoomIndicator).toBe(true);

    act(() => {
      jest.advanceTimersByTime(1000);
      container.dispatchEvent(new WheelEvent('wheel', { ctrlKey: true, deltaY: -100 }));
      jest.advanceTimersByTime(1499);
    });
    expect(result.current.showZoomIndicator).toBe(true);

    act(() => {
      jest.advanceTimersByTime(1);
    });
    expect(result.current.showZoomIndicator).toBe(false);
  });

  it('clears the pending zoom-indicator timer on unmount', () => {
    const container = document.createElement('div');
    const containerRef = { current: container };
    const clearTimeoutSpy = jest.spyOn(globalThis, 'clearTimeout');
    const { unmount } = renderHook(() => useCanvasViewport(containerRef));

    act(() => {
      container.dispatchEvent(new WheelEvent('wheel', { ctrlKey: true, deltaY: -100 }));
    });
    unmount();

    expect(clearTimeoutSpy).toHaveBeenCalled();
  });
});
