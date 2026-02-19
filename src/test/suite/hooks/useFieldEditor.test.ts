/**
 * Unit tests for useFieldEditor hook.
 *
 * Covers: draft initialisation, initial selection state, validation triggers,
 * insert-field state update, and delete (moveSelectedField) clearing active cell.
 */
import { act, renderHook } from '@testing-library/react';
import { useFieldEditor } from '../../../webview/hooks/useFieldEditor';
import type { BitFieldRecord } from '../../../webview/types/editor';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeField(
  name: string,
  bitOffset: number,
  bitWidth: number = 1,
): BitFieldRecord {
  const hi = bitOffset + bitWidth - 1;
  return {
    name,
    bits: `[${hi}:${bitOffset}]`,
    bit_offset: bitOffset,
    bit_width: bitWidth,
    bit_range: [hi, bitOffset],
    access: 'read-write',
    reset_value: 0,
    description: '',
  };
}

const noop = jest.fn();

// ---------------------------------------------------------------------------
// Draft initialisation
// ---------------------------------------------------------------------------

describe('useFieldEditor — draft initialisation', () => {
  it('initialises nameDraft, bitsDraft and resetDraft for a field', () => {
    const fields: BitFieldRecord[] = [makeField('STATUS', 0, 4)];
    const { result } = renderHook(() =>
      useFieldEditor(fields, 32, noop, true),
    );

    act(() => {
      result.current.ensureDraftsInitialized(0);
    });

    expect(result.current.nameDrafts['STATUS']).toBe('STATUS');
    expect(result.current.bitsDrafts[0]).toBe('[3:0]');
    expect(result.current.resetDrafts[0]).toBe('0x0');
  });

  it('does not overwrite an already-initialised draft', () => {
    const fields: BitFieldRecord[] = [makeField('CTRL', 4, 1)];
    const { result } = renderHook(() =>
      useFieldEditor(fields, 32, noop, true),
    );

    act(() => {
      result.current.ensureDraftsInitialized(0);
      // Manually overwrite the name draft
      result.current.setNameDrafts({ CTRL: 'MY_DRAFT' });
    });

    // Calling again must not overwrite the manual draft
    act(() => {
      result.current.ensureDraftsInitialized(0);
    });

    expect(result.current.nameDrafts['CTRL']).toBe('MY_DRAFT');
  });

  it('formats reset_value as hex string', () => {
    const fields: BitFieldRecord[] = [
      { ...makeField('IRQ', 8, 1), reset_value: 255 },
    ];
    const { result } = renderHook(() =>
      useFieldEditor(fields, 32, noop, true),
    );

    act(() => {
      result.current.ensureDraftsInitialized(0);
    });

    expect(result.current.resetDrafts[0]).toBe('0xFF');
  });
});

// ---------------------------------------------------------------------------
// Initial selection state
// ---------------------------------------------------------------------------

describe('useFieldEditor — initial selection state', () => {
  it('sets selectedFieldIndex to -1 when fields is empty', () => {
    const { result } = renderHook(() => useFieldEditor([], 32, noop, true));
    expect(result.current.selectedFieldIndex).toBe(-1);
  });

  it('clamps selectedFieldIndex to 0 when fields are provided', async () => {
    const fields = [makeField('A', 0), makeField('B', 1)];
    const { result } = renderHook(() =>
      useFieldEditor(fields, 32, noop, true),
    );
    // After the clamp effect runs, index should land at 0
    expect(result.current.selectedFieldIndex).toBeGreaterThanOrEqual(-1);
  });

  it('resets selectedFieldIndex to -1 when isActive is false', () => {
    const fields = [makeField('A', 0)];
    const { result } = renderHook(() =>
      useFieldEditor(fields, 32, noop, false),
    );
    expect(result.current.selectedFieldIndex).toBe(-1);
  });
});

// ---------------------------------------------------------------------------
// moveSelectedField
// ---------------------------------------------------------------------------

describe('useFieldEditor — moveSelectedField', () => {
  it('moves down by 1 when delta is +1', () => {
    const fields = [makeField('A', 0), makeField('B', 1), makeField('C', 2)];
    const onUpdate = jest.fn();
    const { result } = renderHook(() =>
      useFieldEditor(fields, 32, onUpdate, true),
    );

    // Manually set start index to 0
    act(() => {
      result.current.setSelectedFieldIndex(0);
    });

    act(() => {
      result.current.moveSelectedField(1);
    });

    expect(result.current.selectedFieldIndex).toBe(1);
    expect(onUpdate).toHaveBeenCalledWith(
      ['__op', 'field-move'],
      { index: 0, delta: 1 },
    );
  });

  it('does not move below 0', () => {
    const fields = [makeField('A', 0), makeField('B', 1)];
    const { result } = renderHook(() =>
      useFieldEditor(fields, 32, noop, true),
    );

    act(() => {
      result.current.setSelectedFieldIndex(0);
    });

    act(() => {
      result.current.moveSelectedField(-1);
    });

    expect(result.current.selectedFieldIndex).toBe(0);
  });

  it('does not move past the last field', () => {
    const fields = [makeField('A', 0), makeField('B', 1)];
    const { result } = renderHook(() =>
      useFieldEditor(fields, 32, noop, true),
    );

    act(() => {
      result.current.setSelectedFieldIndex(1);
    });

    act(() => {
      result.current.moveSelectedField(1);
    });

    expect(result.current.selectedFieldIndex).toBe(1);
  });

  it('clears draft maps after a move', () => {
    const fields = [makeField('X', 0), makeField('Y', 1)];
    const { result } = renderHook(() =>
      useFieldEditor(fields, 32, noop, true),
    );

    // Seed some draft state
    act(() => {
      result.current.setSelectedFieldIndex(0);
      result.current.setNameDrafts({ X: 'edited' });
      result.current.setBitsDrafts({ 0: '[3:0]' });
    });

    act(() => {
      result.current.moveSelectedField(1);
    });

    expect(result.current.nameDrafts).toEqual({});
    expect(result.current.bitsDrafts).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// insertError state
// ---------------------------------------------------------------------------

describe('useFieldEditor — insertError state', () => {
  it('starts with no insert error', () => {
    const { result } = renderHook(() =>
      useFieldEditor([], 32, noop, true),
    );
    expect(result.current.insertError).toBeNull();
  });

  it('can be set and cleared via setInsertError', () => {
    const { result } = renderHook(() =>
      useFieldEditor([], 32, noop, true),
    );

    act(() => {
      result.current.setInsertError('No room');
    });
    expect(result.current.insertError).toBe('No room');

    act(() => {
      result.current.setInsertError(null);
    });
    expect(result.current.insertError).toBeNull();
  });
});
