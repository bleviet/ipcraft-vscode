import { act, renderHook } from '@testing-library/react';
import { useEditableDraft } from '../../../webview/shared/hooks/useEditableDraft';

/**
 * The hook must keep the caret stable for the user's own typing yet still
 * reflect `value` changes that did NOT come from the current keystroke (undo,
 * redo, external file edits). A local edit and an external edit both arrive as
 * a plain `value` change, so the tests model both: a keystroke is `setDraft`
 * plus the optimistic `value` update batched into one render; an external
 * change is a `value` update with no preceding `setDraft`.
 */
describe('useEditableDraft', () => {
  it('adopts an external value change while focused (the undo case)', () => {
    const { result, rerender } = renderHook((props) => useEditableDraft(props.value), {
      initialProps: { value: 'CH_GAIN' },
    });

    act(() => result.current.markFocused());

    // User types "CH_GAINfff" (no normalization: optimistic value === draft).
    act(() => {
      result.current.setDraft('CH_GAINfff');
      rerender({ value: 'CH_GAINfff' });
    });
    expect(result.current.draft).toBe('CH_GAINfff');

    // Ctrl+Z while still focused: a separate event, value reverts on its own.
    act(() => rerender({ value: 'CH_GAIN' }));
    expect(result.current.draft).toBe('CH_GAIN');
  });

  it('keeps the draft for the optimistic echo of the user keystroke (no caret jump)', () => {
    const { result, rerender } = renderHook((props) => useEditableDraft(props.value), {
      initialProps: { value: '0x00000000' },
    });

    act(() => result.current.markFocused());

    // User types "0xF"; the optimistic re-parse normalizes it to a wider hex.
    // Batched into one render, the draft must stay as typed.
    act(() => {
      result.current.setDraft('0xF');
      rerender({ value: '0x0000000F' });
    });
    expect(result.current.draft).toBe('0xF');

    // Next keystroke keeps tracking the user.
    act(() => {
      result.current.setDraft('0xFF');
      rerender({ value: '0x000000FF' });
    });
    expect(result.current.draft).toBe('0xFF');
  });

  it('clears the pending flag on a rejected edit so a later external change still adopts', () => {
    const { result, rerender } = renderHook((props) => useEditableDraft(props.value), {
      initialProps: { value: 'CH_GAIN' },
    });

    act(() => result.current.markFocused());

    // Edit rejected (e.g. invalid): setDraft runs but value never changes.
    act(() => result.current.setDraft('CH_GAINx'));
    expect(result.current.draft).toBe('CH_GAINx');

    // A later external change must still be adopted.
    act(() => rerender({ value: 'OTHER' }));
    expect(result.current.draft).toBe('OTHER');
  });

  it('adopts external value changes when not focused', () => {
    const { result, rerender } = renderHook((props) => useEditableDraft(props.value), {
      initialProps: { value: 'A' },
    });

    act(() => rerender({ value: 'B' }));
    expect(result.current.draft).toBe('B');
  });

  it('re-syncs the draft to the canonical value on blur', () => {
    const { result } = renderHook((props) => useEditableDraft(props.value), {
      initialProps: { value: 'CH_GAIN' },
    });

    act(() => result.current.markFocused());
    // Typed but rejected, so value stayed 'CH_GAIN'.
    act(() => result.current.setDraft('CH_GAINx'));
    expect(result.current.draft).toBe('CH_GAINx');

    act(() => result.current.markBlurred());
    expect(result.current.draft).toBe('CH_GAIN');
  });
});
