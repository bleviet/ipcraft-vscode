import { useCallback, useEffect, useRef, useState } from 'react';
import { SpatialInsertionService } from '../services/SpatialInsertionService';
import type { BitFieldRuntimeDef } from '../services/SpatialInsertionService';
import { fieldToBitsString, parseBitsRange } from '../utils/BitFieldUtils';
import type { BitFieldRecord, YamlUpdateHandler } from '../types/editor';
import { useFieldDrafts } from './useFieldDrafts';
import { useTableEditorState } from './useTableEditorState';

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
  const [insertError, setInsertError] = useState<string | null>(null);

  // ---- drafts ----
  const drafts = useFieldDrafts();
  const {
    nameDrafts,
    setNameDrafts,
    nameErrors,
    setNameErrors,
    bitsDrafts,
    setBitsDrafts,
    bitsErrors,
    setBitsErrors,
    resetDrafts,
    setResetDrafts,
    resetErrors,
    setResetErrors,
    ensureDraftsInitialized,
    clearAllDrafts,
  } = drafts;

  const [dragPreviewRanges, setDragPreviewRanges] = useState<Record<number, [number, number]>>({});
  const previousOrderSignatureRef = useRef<string | null>(null);

  // ---- orchestration state ----
  const editorState = useTableEditorState<BitFieldRecord, EditKey>({
    rows: fields,
    rowsPath: ['fields'],
    columnOrder: COLUMN_ORDER,
    onUpdate,
    rowSelectorAttr: 'data-field-index',
    enableHoverInsert: false, // fields don't use HoverInsertBar
    isActive,
    onAfterRevert: (snapshot: BitFieldRecord[]) => {
      const rowIndex = editorState.activeCell.rowIndex;
      const snapshotField = snapshot[rowIndex];
      if (!snapshotField) {
        return;
      }

      const fieldKey = snapshotField.name ? String(snapshotField.name) : `idx-${rowIndex}`;
      setNameDrafts((prev: Record<string, string>) => ({
        ...prev,
        [fieldKey]: String(snapshotField.name ?? ''),
      }));
      setNameErrors((prev: Record<string, string | null>) => ({ ...prev, [fieldKey]: null }));
      setBitsDrafts((prev: Record<number, string>) => ({
        ...prev,
        [rowIndex]: fieldToBitsString(snapshotField),
      }));
      setBitsErrors((prev: Record<number, string | null>) => ({ ...prev, [rowIndex]: null }));

      const rv = snapshotField.reset_value;
      const resetDisplay =
        rv !== null && rv !== undefined ? `0x${Number(rv).toString(16).toUpperCase()}` : '0x0';
      setResetDrafts((prev: Record<number, string>) => ({ ...prev, [rowIndex]: resetDisplay }));
      setResetErrors((prev: Record<number, string | null>) => ({ ...prev, [rowIndex]: null }));
    },
    onInsertAfter: () => tryInsertField(true),
    onInsertBefore: () => tryInsertField(false),
    onDelete: (rowIndex) => {
      const currentKey = COLUMN_ORDER.includes(editorState.activeCell.key)
        ? editorState.activeCell.key
        : 'name';
      const newFields = fields.filter((_, index) => index !== rowIndex);
      onUpdate(['fields'], newFields);

      const nextRow = rowIndex > 0 ? rowIndex - 1 : newFields.length > 0 ? 0 : -1;
      editorState.setSelectedIndex(nextRow);
      editorState.setHoveredIndex(nextRow);
      editorState.setActiveCell({ rowIndex: nextRow, key: currentKey });

      clearAllDrafts();
    },
    onMove: (fromIndex, delta) => {
      const next = fromIndex + delta;
      if (fromIndex < 0 || fromIndex >= fields.length || next < 0 || next >= fields.length) {
        return;
      }

      onUpdate(['__op', 'field-move'], { index: fromIndex, delta });
      clearAllDrafts();
      editorState.setSelectedIndex(next);
      editorState.setHoveredIndex(next);
    },
  });

  // ---- Internal helpers ----
  const tryInsertField = useCallback(
    (after: boolean) => {
      setInsertError(null);
      const typedFields = toRuntimeFields(fields);
      const result = SpatialInsertionService.insertField(
        after ? 'after' : 'before',
        typedFields,
        editorState.selectedIndex,
        registerSize
      );

      if (result.error) {
        setInsertError(result.error);
        return;
      }

      const newIndex = result.newIndex;
      onUpdate(['fields'], result.items);
      editorState.setSelectedIndex(newIndex);
      editorState.setHoveredIndex(newIndex);
      editorState.setActiveCell({ rowIndex: newIndex, key: 'name' });
      clearAllDrafts();

      window.setTimeout(() => {
        document
          .querySelector(`tr[data-field-index="${newIndex}"]`)
          ?.scrollIntoView({ block: 'center' });
      }, 100);
    },
    [fields, editorState.selectedIndex, registerSize, onUpdate, editorState, clearAllDrafts]
  );

  /** Moves the currently selected field up (-1) or down (+1). */
  const moveSelectedField = useCallback(
    (delta: -1 | 1) => {
      const index = editorState.selectedIndex;
      if (index < 0) {
        return;
      }
      const next = index + delta;
      if (next < 0 || next >= fields.length) {
        return;
      }

      onUpdate(['__op', 'field-move'], { index, delta });
      clearAllDrafts();
      editorState.setSelectedIndex(next);
      editorState.setHoveredIndex(next);
    },
    [editorState.selectedIndex, fields.length, onUpdate, editorState, clearAllDrafts]
  );

  const refocusTableSoon = useCallback(() => {
    window.setTimeout(() => {
      editorState.containerRef.current?.focus();
    }, 0);
  }, [editorState.containerRef]);

  // ---------------------------------------------------------------------------
  // Prune name drafts whose keys no longer match any current field name.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const currentKeys = new Set(fields.map((f, i) => (f.name ? String(f.name) : `idx-${i}`)));
    setNameDrafts((prev) => {
      const stale = Object.keys(prev).filter((k) => !currentKeys.has(k));
      if (stale.length === 0) {
        return prev;
      }
      const next = { ...prev };
      for (const k of stale) {
        delete next[k];
      }
      return next;
    });
    setNameErrors((prev) => {
      const stale = Object.keys(prev).filter((k) => !currentKeys.has(k));
      if (stale.length === 0) {
        return prev;
      }
      const next = { ...prev };
      for (const k of stale) {
        delete next[k];
      }
      return next;
    });
  }, [fields, setNameDrafts, setNameErrors]);

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
  }, [fields, setBitsDrafts, setBitsErrors, setResetDrafts, setResetErrors]);

  return {
    // selection / hover
    selectedFieldIndex: editorState.selectedIndex,
    setSelectedFieldIndex: editorState.setSelectedIndex,
    hoveredFieldIndex: editorState.hoveredIndex,
    setHoveredFieldIndex: editorState.setHoveredIndex,
    selectedEditKey: editorState.activeCell.key,
    setSelectedEditKey: (key: EditKey) => editorState.setActiveCell((prev) => ({ ...prev, key })),
    activeCell: editorState.activeCell,
    setActiveCell: editorState.setActiveCell,

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
    focusRef: editorState.containerRef,
    cancelEditRef: editorState.cancelEditRef,

    // helpers
    ensureDraftsInitialized: (index: number) => ensureDraftsInitialized(index, fields[index]),
    captureEditSnapshot: editorState.captureEditSnapshot,
    moveSelectedField,
    focusFieldEditor: editorState.focusCellEditor,
    refocusTableSoon,
  };
}

/** Return type of {@link useFieldEditor}. */
export type FieldEditorState = ReturnType<typeof useFieldEditor>;
