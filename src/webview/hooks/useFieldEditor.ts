import { useCallback, useEffect, useRef, useState } from 'react';
import { SpatialInsertionService } from '../services/SpatialInsertionService';
import type { BitFieldRuntimeDef } from '../services/SpatialInsertionService';
import { fieldToBitsString, parseBitsRange } from '../utils/BitFieldUtils';
import type { BitFieldRecord, YamlUpdateHandler } from '../types/editor';
import { useTableNavigation } from './useTableNavigation';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type EditKey = 'name' | 'bits' | 'access' | 'reset' | 'description';
export type ActiveCell = { rowIndex: number; key: EditKey };

export const COLUMN_ORDER: EditKey[] = ['name', 'bits', 'access', 'reset', 'description'];

function toRuntimeFields(fields: BitFieldRecord[]): BitFieldRuntimeDef[] {
  return fields.map((field, index) => {
    const bitsString = fieldToBitsString(field);
    const parsed = parseBitsRange(bitsString);
    const msb = parsed?.[0] ?? 0;
    const lsb = parsed?.[1] ?? 0;
    const width = msb - lsb + 1;

    return {
      ...field,
      name: String(field.name ?? `field${index}`),
      bits: bitsString,
      bit_offset: typeof field.bit_offset === 'number' ? field.bit_offset : lsb,
      bit_width: typeof field.bit_width === 'number' ? field.bit_width : width,
      bit_range: [msb, lsb],
      access: String(field.access ?? 'read-write'),
      reset_value: typeof field.reset_value === 'number' ? field.reset_value : 0,
      description: String(field.description ?? ''),
    };
  });
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Manages editing state and operations for bit fields within a register.
 * Handles draft values, validation errors, active cell tracking,
 * and spatial insertion logic.
 *
 * @param fields   Normalised bit field array for the current register.
 * @param registerSize  Register width in bits (e.g. 32).
 * @param onUpdate Callback to commit a YAML path + value change.
 * @param isActive When false the keyboard handler is not installed.
 */
export function useFieldEditor(
  fields: BitFieldRecord[],
  registerSize: number,
  onUpdate: YamlUpdateHandler,
  isActive = true
) {
  // ---- selection / hover ----
  const [selectedFieldIndex, setSelectedFieldIndex] = useState<number>(-1);
  const [hoveredFieldIndex, setHoveredFieldIndex] = useState<number | null>(null);
  const [selectedEditKey, setSelectedEditKey] = useState<EditKey>('name');
  const [activeCell, setActiveCell] = useState<ActiveCell>({
    rowIndex: -1,
    key: 'name',
  });

  // ---- drafts ----
  const [nameDrafts, setNameDrafts] = useState<Record<string, string>>({});
  const [nameErrors, setNameErrors] = useState<Record<string, string | null>>({});
  const [bitsDrafts, setBitsDrafts] = useState<Record<number, string>>({});
  const [bitsErrors, setBitsErrors] = useState<Record<number, string | null>>({});
  const [dragPreviewRanges, setDragPreviewRanges] = useState<Record<number, [number, number]>>({});
  const [resetDrafts, setResetDrafts] = useState<Record<number, string>>({});
  const [resetErrors, setResetErrors] = useState<Record<number, string | null>>({});

  // ---- insert error ----
  const [insertError, setInsertError] = useState<string | null>(null);

  // ---- DOM refs ----
  const focusRef = useRef<HTMLDivElement | null>(null);
  const errorRef = useRef<HTMLDivElement | null>(null);
  const previousOrderSignatureRef = useRef<string | null>(null);

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  const refocusTableSoon = useCallback(() => {
    window.setTimeout(() => {
      focusRef.current?.focus();
    }, 0);
  }, []);

  const focusFieldEditor = useCallback((rowIndex: number, key: EditKey) => {
    window.setTimeout(() => {
      const row = document.querySelector(`tr[data-field-index="${rowIndex}"]`);
      const el = row?.querySelector(`[data-edit-key="${key}"]`) as HTMLElement | null;
      try {
        el?.focus();
      } catch {
        // ignore
      }
    }, 0);
  }, []);

  // ---------------------------------------------------------------------------
  // Public helpers returned to consumers
  // ---------------------------------------------------------------------------

  /** Initialises drafts for row `index` if they haven't been set yet. */
  const ensureDraftsInitialized = useCallback(
    (index: number) => {
      const field = fields[index];
      if (!field) {
        return;
      }
      const key = field.name ? `${field.name}` : `idx-${index}`;
      setNameDrafts((prev) =>
        prev[key] !== undefined ? prev : { ...prev, [key]: String(field.name ?? '') }
      );
      setBitsDrafts((prev) =>
        prev[index] !== undefined ? prev : { ...prev, [index]: fieldToBitsString(field) }
      );
      setResetDrafts((prev) => {
        if (prev[index] !== undefined) {
          return prev;
        }
        const v = field?.reset_value;
        const display =
          v !== null && v !== undefined ? `0x${Number(v).toString(16).toUpperCase()}` : '0x0';
        return { ...prev, [index]: display };
      });
    },
    [fields]
  );

  /** Moves the currently selected field up (-1) or down (+1). */
  const moveSelectedField = useCallback(
    (delta: -1 | 1) => {
      const index = selectedFieldIndex;
      if (index < 0) {
        return;
      }
      const next = index + delta;
      if (next < 0 || next >= fields.length) {
        return;
      }
      onUpdate(['__op', 'field-move'], { index, delta });
      setBitsDrafts({});
      setBitsErrors({});
      setNameDrafts({});
      setNameErrors({});
      setSelectedFieldIndex(next);
      setHoveredFieldIndex(next);
    },
    [selectedFieldIndex, fields.length, onUpdate]
  );

  // ---------------------------------------------------------------------------
  // Clamp selection when the register changes
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!isActive) {
      setSelectedFieldIndex(-1);
      setActiveCell({ rowIndex: -1, key: 'name' });
      return;
    }
    if (!fields.length) {
      setSelectedFieldIndex(-1);
      setActiveCell({ rowIndex: -1, key: 'name' });
      return;
    }
    setSelectedFieldIndex((prev) => {
      if (prev < 0) {
        return 0;
      }
      if (prev >= fields.length) {
        return fields.length - 1;
      }
      return prev;
    });
    setActiveCell((prev) => {
      const rowIndex = prev.rowIndex < 0 ? 0 : Math.min(fields.length - 1, prev.rowIndex);
      const key = COLUMN_ORDER.includes(prev.key) ? prev.key : 'name';
      return { rowIndex, key };
    });
  }, [isActive, fields.length]);

  const tryInsertField = useCallback(
    (after: boolean) => {
      setInsertError(null);
      const typedFields = toRuntimeFields(fields);
      const result = SpatialInsertionService.insertField(
        after ? 'after' : 'before',
        typedFields,
        selectedFieldIndex,
        registerSize
      );

      if (result.error) {
        setInsertError(result.error);
        window.setTimeout(
          () =>
            errorRef.current?.scrollIntoView({
              block: 'nearest',
              behavior: 'smooth',
            }),
          0
        );
        return;
      }

      const newIndex = result.newIndex;
      onUpdate(['fields'], result.items);
      setSelectedFieldIndex(newIndex);
      setHoveredFieldIndex(newIndex);
      setSelectedEditKey('name');
      setActiveCell({ rowIndex: newIndex, key: 'name' });
      setBitsDrafts({});
      setBitsErrors({});
      setNameDrafts({});
      setNameErrors({});
      window.setTimeout(() => {
        document
          .querySelector(`tr[data-row-idx="${newIndex}"]`)
          ?.scrollIntoView({ block: 'center' });
      }, 100);
    },
    [fields, selectedFieldIndex, registerSize, onUpdate]
  );

  const handleEdit = useCallback(
    (rowIndex: number, key: EditKey) => {
      if (rowIndex < 0 || rowIndex >= fields.length) {
        return;
      }
      setSelectedFieldIndex(rowIndex);
      setHoveredFieldIndex(rowIndex);
      setSelectedEditKey(key);
      setActiveCell({ rowIndex, key });
      focusFieldEditor(rowIndex, key);
    },
    [fields.length, focusFieldEditor]
  );

  const handleDelete = useCallback(
    (rowIndex: number) => {
      if (rowIndex < 0 || rowIndex >= fields.length) {
        return;
      }
      const currentKey: EditKey = COLUMN_ORDER.includes(activeCell.key) ? activeCell.key : 'name';
      const newFields = fields.filter((_, index) => index !== rowIndex);
      onUpdate(['fields'], newFields);
      const nextRow = rowIndex > 0 ? rowIndex - 1 : newFields.length > 0 ? 0 : -1;
      setSelectedFieldIndex(nextRow);
      setHoveredFieldIndex(nextRow);
      setActiveCell({ rowIndex: nextRow, key: currentKey });
      setBitsDrafts({});
      setBitsErrors({});
      setNameDrafts({});
      setNameErrors({});
    },
    [fields, activeCell.key, onUpdate]
  );

  const handleMove = useCallback(
    (fromIndex: number, delta: number) => {
      const next = fromIndex + delta;
      if (fromIndex < 0 || fromIndex >= fields.length || next < 0 || next >= fields.length) {
        return;
      }
      onUpdate(['__op', 'field-move'], { index: fromIndex, delta });
      setBitsDrafts({});
      setBitsErrors({});
      setNameDrafts({});
      setNameErrors({});
      setSelectedFieldIndex(next);
      setHoveredFieldIndex(next);
    },
    [fields.length, onUpdate]
  );

  useTableNavigation<EditKey>({
    activeCell,
    setActiveCell,
    rowCount: fields.length,
    columnOrder: COLUMN_ORDER,
    containerRef: focusRef as React.RefObject<HTMLElement>,
    onEdit: handleEdit,
    onDelete: handleDelete,
    onMove: handleMove,
    onInsertAfter: () => tryInsertField(true),
    onInsertBefore: () => tryInsertField(false),
    isActive,
  });

  useEffect(() => {
    if (!isActive) {
      return;
    }
    const rowIndex = activeCell.rowIndex;
    if (rowIndex >= 0 && rowIndex < fields.length) {
      setSelectedFieldIndex(rowIndex);
      setHoveredFieldIndex(rowIndex);
    }
    if (COLUMN_ORDER.includes(activeCell.key)) {
      setSelectedEditKey(activeCell.key);
    }
  }, [activeCell, isActive, fields.length]);

  // ---------------------------------------------------------------------------
  // Escape: return focus from inline editor back to the table container
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!isActive) {
      return;
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') {
        return;
      }
      const activeEl = document.activeElement as HTMLElement | null;
      if (!activeEl) {
        return;
      }
      const inFields =
        !!focusRef.current && focusRef.current.contains(activeEl) && activeEl !== focusRef.current;
      if (!inFields) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      try {
        activeEl.blur?.();
      } catch {
        // ignore
      }
      refocusTableSoon();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isActive, refocusTableSoon]);

  // ---------------------------------------------------------------------------
  // Keep index-keyed drafts aligned with field order
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const orderSignature = fields
      .map((field, index) => {
        const name = String(field?.name ?? `idx-${index}`);
        const bits = fieldToBitsString(field);
        return `${name}|${bits}`;
      })
      .join('||');

    const previousSignature = previousOrderSignatureRef.current;
    previousOrderSignatureRef.current = orderSignature;

    if (previousSignature === null || previousSignature === orderSignature) {
      return;
    }

    setBitsDrafts({});
    setBitsErrors({});
    setDragPreviewRanges({});
    setResetDrafts({});
    setResetErrors({});
  }, [fields]);

  return {
    // selection / hover
    selectedFieldIndex,
    setSelectedFieldIndex,
    hoveredFieldIndex,
    setHoveredFieldIndex,
    selectedEditKey,
    setSelectedEditKey,
    activeCell,
    setActiveCell,
    // drafts
    nameDrafts,
    setNameDrafts,
    nameErrors,
    setNameErrors,
    bitsDrafts,
    setBitsDrafts,
    bitsErrors,
    setBitsErrors,
    dragPreviewRanges,
    setDragPreviewRanges,
    resetDrafts,
    setResetDrafts,
    resetErrors,
    setResetErrors,
    // insert error
    insertError,
    setInsertError,
    // refs
    focusRef,
    errorRef,
    // helpers
    ensureDraftsInitialized,
    moveSelectedField,
    focusFieldEditor,
    refocusTableSoon,
  };
}

/** Return type of {@link useFieldEditor}. */
export type FieldEditorState = ReturnType<typeof useFieldEditor>;
