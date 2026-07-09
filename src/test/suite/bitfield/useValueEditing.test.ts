import { act, renderHook } from '@testing-library/react';
import { useValueEditing } from '../../../webview/components/bitfield/useValueEditing';

/**
 * Unlike useEditableDraft, this hook only writes registerValue on commit
 * (blur/Enter), never per keystroke, so there is no "echo of my own typing"
 * to guard against. A registerValue change observed while still editing can
 * only be external (undo/redo, or an edit to the underlying fields from
 * elsewhere) and must be adopted immediately rather than frozen until blur.
 */
describe('useValueEditing', () => {
  const baseOptions = {
    registerSize: 32,
    parseRegisterValue: (text: string, view: 'hex' | 'dec') => {
      const n = view === 'hex' ? parseInt(text, 16) : parseInt(text, 10);
      return Number.isNaN(n) ? null : n;
    },
    maxForBits: (bitCount: number) => 2 ** bitCount - 1,
    applyRegisterValue: () => undefined,
  };

  it('adopts an external registerValue change while editing (the undo case)', () => {
    const { result, rerender } = renderHook((props) => useValueEditing(props), {
      initialProps: { ...baseOptions, registerValue: 0x10 },
    });

    expect(result.current.valueDraft).toBe('00000010');

    act(() => result.current.setValueEditing(true));
    act(() => result.current.setValueDraft('000010ff'));
    expect(result.current.valueDraft).toBe('000010ff');

    // Undo elsewhere reverts the field this Value bar aggregates, while the
    // Value bar is still focused.
    act(() => rerender({ ...baseOptions, registerValue: 0x5 }));

    expect(result.current.valueDraft).toBe('00000005');
  });

  it('does not disrupt an in-progress edit when only the hex/dec view toggles', () => {
    const { result } = renderHook((props) => useValueEditing(props), {
      initialProps: { ...baseOptions, registerValue: 0x10 },
    });

    act(() => result.current.setValueEditing(true));
    act(() => result.current.setValueDraft('000010ff'));

    act(() => result.current.setValueView('dec'));

    expect(result.current.valueDraft).toBe('000010ff');
  });

  it('resyncs the draft to the canonical text on commit (editing -> false)', () => {
    const { result, rerender } = renderHook((props) => useValueEditing(props), {
      initialProps: { ...baseOptions, registerValue: 0x10 },
    });

    act(() => result.current.setValueEditing(true));
    act(() => result.current.setValueDraft('20'));

    // Commit: registerValue updates and editing flips false in the same batch.
    act(() => result.current.setValueEditing(false));
    rerender({ ...baseOptions, registerValue: 0x20 });

    expect(result.current.valueDraft).toBe('00000020');
  });

  it('adopts registerValue changes when not editing', () => {
    const { result, rerender } = renderHook((props) => useValueEditing(props), {
      initialProps: { ...baseOptions, registerValue: 0x1 },
    });

    rerender({ ...baseOptions, registerValue: 0x2 });
    expect(result.current.valueDraft).toBe('00000002');
  });

  it('pads the hex draft to the register width (e.g. 32 bits -> 8 digits)', () => {
    const { result } = renderHook((props) => useValueEditing(props), {
      initialProps: { ...baseOptions, registerSize: 8, registerValue: 0xa },
    });

    expect(result.current.valueDraft).toBe('0A');
  });
});
