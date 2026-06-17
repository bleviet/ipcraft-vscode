import { useCallback, useEffect, useRef, useState } from 'react';
import { SpatialInsertionService } from '../services/SpatialInsertionService';
import type { BitFieldRuntimeDef } from '../services/SpatialInsertionService';
import { fieldToBitsString, parseBitsRange } from '../utils/BitFieldUtils';
import type { BitFieldRecord, YamlUpdateHandler } from '../types/editor';
import { useFieldDrafts } from './useFieldDrafts';
import { useTableEditorState } from './useTableEditorState';
import { reconcileRowIds, type TableRowWrapper } from '../utils/rowIdentity';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type EditKey = 'name' | 'bits' | 'access' | 'reset' | 'description';
export type ActiveCell = { rowId: string | null; key: EditKey };

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
      offset: typeof field.offset === 'number' ? field.offset : lsb,
      width: typeof field.width === 'number' ? field.width : width,
      bitRange: [msb, lsb],
      access: String(field.access ?? 'read-write'),
      resetValue: typeof field.resetValue === 'number' ? field.resetValue : 0,
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

  // ---- wrapped rows for row identity ----
  const [wrappedFields, setWrappedFields] = useState<Array<TableRowWrapper<BitFieldRecord>>>(() =>
    reconcileRowIds(undefined, fields)
  );

  useEffect(() => {
    setWrappedFields((prev) => reconcileRowIds(prev, fields));
  }, [fields]);

  // ---- drafts ----
  const drafts = useFieldDrafts();
  const {
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

  const [dragPreviewRanges, setDragPreviewRanges] = useState<Record<string, [number, number]>>({});

  // ---- orchestration state ----
  const editorState = useTableEditorState<BitFieldRecord, EditKey>({
    rows: wrappedFields,
    rowsPath: ['fields'],
    columnOrder: COLUMN_ORDER,
    onUpdate,
    rowSelectorAttr: 'data-row-id',
    enableHoverInsert: false, // fields don't use HoverInsertBar
    isActive,
    onAfterRevert: (snapshot: BitFieldRecord[]) => {
      const rowId = editorState.activeCell.rowId;
      if (!rowId) {
        return;
      }
      const rowIndex = wrappedFields.findIndex((w) => w.rowId === rowId);
      const snapshotField = snapshot[rowIndex];
      if (!snapshotField) {
        return;
      }

      setBitsDrafts((prev: Record<string, string>) => ({
        ...prev,
        [rowId]: fieldToBitsString(snapshotField),
      }));
      setBitsErrors((prev: Record<string, string | null>) => ({ ...prev, [rowId]: null }));

      const rv = snapshotField.resetValue;
      const resetDisplay =
        rv !== null && rv !== undefined ? `0x${Number(rv).toString(16).toUpperCase()}` : '0x0';
      setResetDrafts((prev: Record<string, string>) => ({ ...prev, [rowId]: resetDisplay }));
      setResetErrors((prev: Record<string, string | null>) => ({ ...prev, [rowId]: null }));
    },
    onInsertAfter: () => tryInsertField(true),
    onInsertBefore: () => tryInsertField(false),
    onDelete: (rowId) => {
      const rowIndex = wrappedFields.findIndex((w) => w.rowId === rowId);
      if (rowIndex < 0) {
        return;
      }
      const currentKey = COLUMN_ORDER.includes(editorState.activeCell.key)
        ? editorState.activeCell.key
        : 'name';
      const newFields = fields.filter((_, index) => index !== rowIndex);
      onUpdate(['fields'], newFields);

      const nextRow = rowIndex < newFields.length ? rowIndex : newFields.length - 1;
      window.setTimeout(() => {
        editorState.selectRow(nextRow, currentKey);
      }, 0);

      clearAllDrafts();
    },
    onMove: (rowId, delta) => {
      const fromIndex = wrappedFields.findIndex((w) => w.rowId === rowId);
      const next = fromIndex + delta;
      if (fromIndex < 0 || fromIndex >= fields.length || next < 0 || next >= fields.length) {
        return;
      }

      onUpdate(['__op', 'field-move'], { index: fromIndex, delta });
      clearAllDrafts();
    },
  });

  const pendingSelectRef = useRef<{ name: string; key: EditKey } | null>(null);

  useEffect(() => {
    if (pendingSelectRef.current) {
      const { name, key } = pendingSelectRef.current;
      const index = wrappedFields.findIndex((w) => w.model.name === name);
      if (index >= 0) {
        const rowId = wrappedFields[index].rowId;
        editorState.selectRow(index, key);
        document.querySelector(`tr[data-row-id="${rowId}"]`)?.scrollIntoView({ block: 'center' });
        pendingSelectRef.current = null;
      }
    }
  }, [wrappedFields, editorState]);

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
      pendingSelectRef.current = { name: result.items[newIndex].name, key: 'name' };
      onUpdate(['fields'], result.items);
      clearAllDrafts();
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
    },
    [editorState.selectedIndex, fields.length, onUpdate, clearAllDrafts]
  );

  const refocusTableSoon = useCallback(() => {
    window.setTimeout(() => {
      editorState.containerRef.current?.focus();
    }, 0);
  }, [editorState.containerRef]);

  return {
    // wrapped rows
    wrappedFields,

    // selection / hover
    selectedFieldIndex: editorState.selectedIndex,
    setSelectedFieldIndex: editorState.setSelectedFieldIndex,
    hoveredFieldIndex: editorState.hoveredIndex,
    setHoveredFieldIndex: editorState.setHoveredFieldIndex,
    selectedEditKey: editorState.activeCell.key,
    setSelectedEditKey: (key: EditKey) => editorState.setActiveCell((prev) => ({ ...prev, key })),
    activeCell: editorState.activeCell,
    setActiveCell: editorState.setActiveCell,

    // drafts
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
    ensureDraftsInitialized: (rowId: string, index: number) =>
      ensureDraftsInitialized(rowId, fields[index]),
    captureEditSnapshot: editorState.captureEditSnapshot,
    moveSelectedField,
    focusFieldEditor: editorState.focusCellEditor,
    refocusTableSoon,
  };
}

/** Return type of {@link useFieldEditor}. */
export type FieldEditorState = ReturnType<typeof useFieldEditor>;
