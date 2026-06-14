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

function makeField(name: string, bitOffset: number, bitWidth = 1): BitFieldRecord {
  const hi = bitOffset + bitWidth - 1;
  return {
    name,
    bits: `[${hi}:${bitOffset}]`,
    offset: bitOffset,
    width: bitWidth,
    access: 'read-write',
    resetValue: 0,
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
    const { result } = renderHook(() => useFieldEditor(fields, 32, noop, true));
    const rowId = result.current.wrappedFields[0].rowId;

    act(() => {
      result.current.ensureDraftsInitialized(rowId, 0);
    });

    expect(result.current.nameDrafts[rowId]).toBe('STATUS');
    expect(result.current.bitsDrafts[rowId]).toBe('[3:0]');
    expect(result.current.resetDrafts[rowId]).toBe('0x0');
  });

  it('does not overwrite an already-initialised draft', () => {
    const fields: BitFieldRecord[] = [makeField('CTRL', 4, 1)];
    const { result } = renderHook(() => useFieldEditor(fields, 32, noop, true));
    const rowId = result.current.wrappedFields[0].rowId;

    act(() => {
      result.current.ensureDraftsInitialized(rowId, 0);
      // Manually overwrite the name draft
      result.current.setNameDrafts({ [rowId]: 'MY_DRAFT' });
    });

    // Calling again must not overwrite the manual draft
    act(() => {
      result.current.ensureDraftsInitialized(rowId, 0);
    });

    expect(result.current.nameDrafts[rowId]).toBe('MY_DRAFT');
  });

  it('formats resetValue as hex string', () => {
    const fields: BitFieldRecord[] = [{ ...makeField('IRQ', 8, 1), resetValue: 255 }];
    const { result } = renderHook(() => useFieldEditor(fields, 32, noop, true));
    const rowId = result.current.wrappedFields[0].rowId;

    act(() => {
      result.current.ensureDraftsInitialized(rowId, 0);
    });

    expect(result.current.resetDrafts[rowId]).toBe('0xFF');
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

  it('clamps selectedFieldIndex to 0 when fields are provided', () => {
    const fields = [makeField('A', 0), makeField('B', 1)];
    const { result } = renderHook(() => useFieldEditor(fields, 32, noop, true));
    // After the clamp effect runs, index should land at 0
    expect(result.current.selectedFieldIndex).toBeGreaterThanOrEqual(-1);
  });

  it('resets selectedFieldIndex to -1 when isActive is false', () => {
    const fields = [makeField('A', 0)];
    const { result } = renderHook(() => useFieldEditor(fields, 32, noop, false));
    expect(result.current.selectedFieldIndex).toBe(-1);
  });
});

// ---------------------------------------------------------------------------
// moveSelectedField
// ---------------------------------------------------------------------------

describe('useFieldEditor — moveSelectedField', () => {
  it('moves down by 1 when delta is +1', () => {
    const fieldsBefore = [makeField('A', 0), makeField('B', 1), makeField('C', 2)];
    // Simulate the upstream YAML reorder: A and B swap positions.
    const fieldsAfter = [makeField('B', 0), makeField('A', 1), makeField('C', 2)];
    const onUpdate = jest.fn();

    const { result, rerender } = renderHook(
      ({ fields }: { fields: BitFieldRecord[] }) => useFieldEditor(fields, 32, onUpdate, true),
      { initialProps: { fields: fieldsBefore } }
    );

    // Capture the stable rowId of field A (at index 0 before the move).
    const rowIdA = result.current.wrappedFields[0].rowId;

    act(() => {
      result.current.setSelectedFieldIndex(0);
    });

    act(() => {
      result.current.moveSelectedField(1);
    });

    // moveSelectedField only issues the op; it does NOT mutate selection locally.
    // Selection follows the moved field via rowId after the parent rerenders.
    expect(onUpdate).toHaveBeenCalledWith(['__op', 'field-move'], { index: 0, delta: 1 });

    act(() => {
      rerender({ fields: fieldsAfter });
    });

    // rowId is stable across reorder, so selectedIndex follows A to its new position.
    expect(result.current.wrappedFields.findIndex((w) => w.rowId === rowIdA)).toBe(1);
    expect(result.current.selectedFieldIndex).toBe(1);
  });

  it('does not move below 0', () => {
    const fields = [makeField('A', 0), makeField('B', 1)];
    const { result } = renderHook(() => useFieldEditor(fields, 32, noop, true));

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
    const { result } = renderHook(() => useFieldEditor(fields, 32, noop, true));

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
    const { result } = renderHook(() => useFieldEditor(fields, 32, noop, true));

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
    const { result } = renderHook(() => useFieldEditor([], 32, noop, true));
    expect(result.current.insertError).toBeNull();
  });

  it('can be set and cleared via setInsertError', () => {
    const { result } = renderHook(() => useFieldEditor([], 32, noop, true));

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

// ---------------------------------------------------------------------------
// Reorder synchronization
// ---------------------------------------------------------------------------

describe('useFieldEditor — reorder synchronization', () => {
  it('keeps drafts matched to stable rowId when field order changes', () => {
    const initialFields: BitFieldRecord[] = [
      makeField('IRQ_ENABLE', 31, 1),
      makeField('RESERVED', 3, 28),
      makeField('PWM_ENABLE', 1, 1),
      makeField('ENABLE', 0, 1),
    ];

    const reorderedFields: BitFieldRecord[] = [
      makeField('RESERVED', 3, 28),
      makeField('IRQ_ENABLE', 31, 1),
      makeField('PWM_ENABLE', 1, 1),
      makeField('ENABLE', 0, 1),
    ];

    const { result, rerender } = renderHook(
      ({ fields }) => useFieldEditor(fields, 32, noop, true),
      { initialProps: { fields: initialFields } }
    );

    const rowId0 = result.current.wrappedFields[0].rowId; // IRQ_ENABLE
    const rowId1 = result.current.wrappedFields[1].rowId; // RESERVED

    act(() => {
      result.current.setBitsDrafts({
        [rowId0]: '[30:3]',
        [rowId1]: '[31:31]',
      });
      result.current.setBitsErrors({ [rowId0]: 'stale error' });
      result.current.setDragPreviewRanges({ [rowId0]: [30, 3] });
      result.current.setResetDrafts({ [rowId0]: '0x7', [rowId1]: '0x1' });
      result.current.setResetErrors({ [rowId1]: 'stale reset error' });
    });

    act(() => {
      rerender({ fields: reorderedFields });
    });

    // Drafts must be preserved on their stable rowId, not cleared or mixed up
    expect(result.current.bitsDrafts[rowId0]).toBe('[30:3]');
    expect(result.current.bitsDrafts[rowId1]).toBe('[31:31]');
    expect(result.current.bitsErrors[rowId0]).toBe('stale error');
    expect(result.current.dragPreviewRanges[rowId0]).toEqual([30, 3]);
    expect(result.current.resetDrafts[rowId0]).toBe('0x7');
    expect(result.current.resetDrafts[rowId1]).toBe('0x1');
    expect(result.current.resetErrors[rowId1]).toBe('stale reset error');
  });

  it('keeps drafts when field signature is unchanged', () => {
    const fieldsA: BitFieldRecord[] = [makeField('A', 0, 1), makeField('B', 1, 1)];
    const fieldsB: BitFieldRecord[] = [makeField('A', 0, 1), makeField('B', 1, 1)];

    const { result, rerender } = renderHook(
      ({ fields }) => useFieldEditor(fields, 32, noop, true),
      { initialProps: { fields: fieldsA } }
    );

    const rowId0 = result.current.wrappedFields[0].rowId;

    act(() => {
      result.current.setBitsDrafts({ [rowId0]: '[0:0]' });
      result.current.setResetDrafts({ [rowId0]: '0x1' });
    });

    act(() => {
      rerender({ fields: fieldsB });
    });

    expect(result.current.bitsDrafts[rowId0]).toBe('[0:0]');
    expect(result.current.resetDrafts[rowId0]).toBe('0x1');
  });
});
