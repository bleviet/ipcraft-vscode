import { act, renderHook } from '@testing-library/react';
import { useCtrlDrag } from '../../../webview/components/bitfield/useCtrlDrag';
import { CTRL_DRAG_INITIAL } from '../../../webview/components/bitfield/types';

describe('useCtrlDrag', () => {
  it('cancels the preview when the drag state goes from active to inactive', () => {
    const onCancelPreview = jest.fn();
    const { result } = renderHook(() => useCtrlDrag({ onCancelPreview }));
    expect(onCancelPreview).not.toHaveBeenCalled();

    act(() => {
      result.current.setCtrlDrag({
        active: true,
        draggedFieldIndex: 0,
        previewSegments: null,
        previewValid: true,
      });
    });
    expect(onCancelPreview).not.toHaveBeenCalled();

    act(() => {
      result.current.setCtrlDrag(CTRL_DRAG_INITIAL);
    });
    expect(onCancelPreview).toHaveBeenCalledTimes(1);
  });
});
