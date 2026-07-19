import React, { useCallback, useEffect, useImperativeHandle, useMemo, useState } from 'react';
import type { YamlUpdateHandler, BitFieldRecord } from '../../types/editor';
import BitFieldVisualizer from '../BitFieldVisualizer';
import {
  KeyboardShortcutsButton,
  EditorHeader,
  TwoPanelEditorLayout,
} from '../../shared/components';
import { FieldsTable } from './FieldsTable';
import { useFieldEditor } from '../../hooks/useFieldEditor';
import { useDebugMode } from '../../hooks/useDebugMode';
import { useValueEditing } from '../bitfield/useValueEditing';
import ValueBar from '../bitfield/ValueBar';
import {
  applyRegisterBitVectorToFields,
  buildRegisterBitVector,
  parseRegisterBitVector,
} from '../bitfield/utils';
import type { RegisterDef } from '../../types/memoryMap';
import { generateUniqueName } from '../../utils/naming';
import { formatBitsRange } from '../../utils/BitFieldUtils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RegisterEditorProps {
  /** The register to display and edit. */
  register: RegisterDef;
  /** Normalised bit fields (with offset / width). */
  fields: BitFieldRecord[];
  registerLayout: 'stacked' | 'side-by-side';
  toggleRegisterLayout: () => void;
  selectionMeta?: {
    absoluteAddress?: number;
    relativeOffset?: number;
    focusDetails?: boolean;
  };
  onUpdate: YamlUpdateHandler;
  /** Header title override (defaults to the register name). */
  title?: string;
  /** Extra content rendered below the header title (e.g. array dimensions). */
  headerChildren?: React.ReactNode;
  /** Keyboard-shortcuts context for the footer (defaults to 'register'). */
  footerContext?: 'register' | 'array';
  /**
   * When true, render only the bit-field visualizer + fields table (no header,
   * no footer). Used when embedded as the detail pane of a block master-detail,
   * where the register's identity is shown/edited in the surrounding rail.
   */
  embedded?: boolean;
}

export type RegisterEditorHandle = {
  focus: () => void;
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Renders and manages editing of a single register's properties, including:
 * - Register name / description header
 * - Interactive BitFieldVisualizer
 * - Editable FieldsTable with keyboard navigation
 *
 * Exposes a `focus()` method via ref.
 */
export const RegisterEditor = React.forwardRef<RegisterEditorHandle, RegisterEditorProps>(
  (
    {
      register,
      fields,
      registerLayout,
      toggleRegisterLayout,
      selectionMeta,
      onUpdate,
      title,
      headerChildren,
      footerContext = 'register',
      embedded = false,
    },
    ref
  ) => {
    const registerSize = register?.size ?? 32;

    // Debug Mode: while on, register value exploration (bit clicks / typed
    // reset values) is kept local to this component and never reaches
    // `onUpdate`, so it can't accidentally end up in the .mm.yml file.
    // See https://github.com/bleviet/ipcraft-vscode/issues/39.
    const { debugMode } = useDebugMode();
    const [debugOverrides, setDebugOverrides] = useState<Record<number, number | bigint | null>>(
      {}
    );

    useEffect(() => {
      setDebugOverrides({});
    }, [debugMode, register?.name]);

    const effectiveFields = useMemo(() => {
      if (!debugMode || Object.keys(debugOverrides).length === 0) {
        return fields;
      }
      return fields.map((f, i) => {
        const override = debugOverrides[i];
        return Object.prototype.hasOwnProperty.call(debugOverrides, i) &&
          typeof override !== 'bigint'
          ? { ...f, resetValue: override }
          : f;
      });
    }, [fields, debugMode, debugOverrides]);

    const debugAwareUpdate: YamlUpdateHandler = useCallback(
      (path, value) => {
        if (debugMode) {
          const [seg0, seg1, seg2] = path;
          if (seg0 === 'fields' && typeof seg1 === 'number' && seg2 === 'resetValue') {
            setDebugOverrides((prev) => ({
              ...prev,
              [seg1]: value as number | bigint | null,
            }));
          }
          return;
        }
        onUpdate(path, value);
      },
      [debugMode, onUpdate]
    );

    const fieldEditor = useFieldEditor(effectiveFields, registerSize, debugAwareUpdate, true);

    const {
      hoveredFieldIndex,
      setHoveredFieldIndex,
      setDragPreviewRanges,
      setBitsDrafts,
      focusRef,
    } = fieldEditor;

    // Expose focus() to parent (e.g. DetailsPanel's useImperativeHandle).
    useImperativeHandle(
      ref,
      () => ({
        focus: () => {
          focusRef.current?.focus();
        },
      }),
      []
    );

    // Auto-focus when selectionMeta.focusDetails is set.
    useEffect(() => {
      if (!selectionMeta?.focusDetails) {
        return;
      }
      const id = window.setTimeout(() => {
        focusRef.current?.focus();
      }, 0);
      return () => window.clearTimeout(id);
    }, [selectionMeta?.focusDetails, register?.name]);

    // Normalise fields for BitFieldVisualizer (provide bitRange).
    const normalisedFields = useMemo(() => {
      return effectiveFields.map((f: BitFieldRecord, fieldIndex) => {
        // `effectiveFields` drops bigint debug overrides (they can't round-trip
        // through the number-typed `.mm.yml` reset value), so reapply them here
        // regardless of which branch below computes the rest of the field --
        // otherwise a >53-bit debug value silently reverts on every render.
        const debugValue = debugMode ? debugOverrides[fieldIndex] : undefined;
        const resetValue =
          typeof debugValue === 'bigint' ? debugValue : (f.resetValue ?? undefined);
        const mappedF = {
          ...f,
          name: f.name ?? undefined,
          bits: f.bits ?? undefined,
          offset: f.offset ?? undefined,
          width: f.width ?? undefined,
          access: f.access ?? undefined,
          resetValue,
          description: f.description ?? undefined,
        };
        if (
          mappedF.offset !== undefined &&
          mappedF.width !== undefined &&
          mappedF.offset !== null &&
          mappedF.width !== null
        ) {
          const lo = Number(mappedF.offset);
          const width = Number(mappedF.width);
          const hi = lo + width - 1;
          return { ...mappedF, bitRange: [hi, lo] as [number, number] };
        }
        return mappedF;
      });
    }, [effectiveFields, debugMode, debugOverrides]);

    const handleUpdateFieldReset = useCallback(
      (fieldIndex: number, resetValue: number | bigint | null) => {
        debugAwareUpdate(['fields', fieldIndex, 'resetValue'], resetValue);
      },
      [debugAwareUpdate]
    );

    const registerValue = useMemo(
      () => buildRegisterBitVector(normalisedFields, registerSize),
      [normalisedFields, registerSize]
    );

    const applyRegisterValue = useCallback(
      (value: import('../../../dataInspector/BitVector').BitVector) => {
        let unsafeForYaml = false;
        applyRegisterBitVectorToFields(normalisedFields, value, (_fieldIndex, fieldValue) => {
          unsafeForYaml ||= typeof fieldValue === 'bigint';
        });
        if (!debugMode && unsafeForYaml) {
          return "Values above JavaScript's safe integer limit require Debug Mode";
        }
        applyRegisterBitVectorToFields(normalisedFields, value, handleUpdateFieldReset);
        return null;
      },
      [normalisedFields, handleUpdateFieldReset, debugMode]
    );

    const {
      valueView,
      setValueView,
      valueDraft,
      setValueDraft,
      setValueEditing,
      valueError,
      setValueError,
      validateRegisterValue,
      commitRegisterValueDraft,
    } = useValueEditing({
      registerSize,
      registerValue,
      parseRegisterValue: (text, view) => parseRegisterBitVector(text, view, registerSize),
      applyRegisterValue,
    });

    const valueBar = (
      <ValueBar
        valueDraft={valueDraft}
        valueError={valueError}
        valueView={valueView}
        setValueDraft={setValueDraft}
        setValueEditing={setValueEditing}
        setValueError={setValueError}
        setValueView={setValueView}
        parseRegisterValue={(text, view) => parseRegisterBitVector(text, view, registerSize)}
        validateRegisterValue={validateRegisterValue}
        commitRegisterValueDraft={commitRegisterValueDraft}
      />
    );

    const visualizerProps = {
      fields: normalisedFields,
      hoveredFieldIndex,
      setHoveredFieldIndex,
      registerSize,
      onUpdateFieldReset: handleUpdateFieldReset,
      onUpdateFieldRange: (fieldIndex: number, newRange: [number, number]) => {
        const [hi, lo] = newRange;
        const field = fields[fieldIndex];
        const updatedField = {
          ...field,
          bits: formatBitsRange(hi, lo),
          offset: lo,
          width: hi - lo + 1,
          bitRange: [hi, lo] as [number, number],
        };
        const newFields = [...fields];
        newFields[fieldIndex] = updatedField;
        // Keep the fields array sorted by bit position. The table cascade in
        // FieldTableRow treats array order as bit order; a single-field move
        // that left the array unsorted would make the cascade push the wrong
        // fields (and overflow the register). Mirror onBatchUpdateFields.
        newFields.sort((a, b) => {
          const aLo = a.offset ?? 0;
          const bLo = b.offset ?? 0;
          return aLo - bLo;
        });
        debugAwareUpdate(['fields'], newFields);
        setBitsDrafts((prev: Record<string, string>) => {
          const next = { ...prev };
          const rowId = fieldEditor.wrappedFields[fieldIndex]?.rowId;
          if (rowId) {
            delete next[rowId];
          }
          return next;
        });
      },
      onBatchUpdateFields: (updates: { idx: number; range: [number, number] }[]) => {
        const newFields = [...fields];
        updates.forEach(({ idx, range }) => {
          const [hi, lo] = range;
          const field = newFields[idx];
          if (field) {
            newFields[idx] = {
              ...field,
              bits: formatBitsRange(hi, lo),
              offset: lo,
              width: hi - lo + 1,
              bitRange: [hi, lo] as [number, number],
            };
          }
        });
        newFields.sort((a, b) => {
          const aLo = a.offset ?? 0;
          const bLo = b.offset ?? 0;
          return aLo - bLo;
        });
        debugAwareUpdate(['fields'], newFields);
        setBitsDrafts((prev: Record<string, string>) => {
          const next = { ...prev };
          updates.forEach(({ idx }) => {
            const rowId = fieldEditor.wrappedFields[idx]?.rowId;
            if (rowId) {
              delete next[rowId];
            }
          });
          return next;
        });
      },
      onCreateField: (newField: { bitRange: [number, number]; name: string }) => {
        const name = generateUniqueName(fields, 'field');
        const [hi, lo] = newField.bitRange;
        const field = {
          name,
          bits: formatBitsRange(hi, lo),
          offset: lo,
          width: hi - lo + 1,
          bitRange: [hi, lo] as [number, number],
          access: 'read-write',
          resetValue: 0,
          description: '',
        };

        const newFields = [...fields, field].sort((a, b) => {
          const aLo = a.offset ?? 0;
          const bLo = b.offset ?? 0;
          return aLo - bLo;
        });
        debugAwareUpdate(['fields'], newFields);
      },
      onDragPreview: (preview: { idx: number; range: [number, number] }[] | null) => {
        if (preview === null) {
          setDragPreviewRanges({});
        } else {
          const newRanges: Record<string, [number, number]> = {};
          preview.forEach(({ idx, range }) => {
            const rowId = fieldEditor.wrappedFields[idx]?.rowId;
            if (rowId) {
              newRanges[rowId] = range;
            }
          });
          setDragPreviewRanges(newRanges);
        }
      },
      onDeleteField: (fieldIndex: number) => {
        const rowId = fieldEditor.wrappedFields[fieldIndex]?.rowId;
        if (rowId) {
          fieldEditor.deleteField(rowId);
        }
      },
    };

    return (
      <TwoPanelEditorLayout
        header={
          embedded ? null : (
            <EditorHeader
              title={title ?? register.name ?? ''}
              description={register.description}
              layout={registerLayout}
              onToggleLayout={toggleRegisterLayout}
            >
              {headerChildren}
            </EditorHeader>
          )
        }
        visualizer={
          <BitFieldVisualizer
            {...visualizerProps}
            layout={registerLayout === 'side-by-side' ? 'vertical' : 'pro'}
          />
        }
        table={
          <FieldsTable
            fields={effectiveFields}
            registerSize={registerSize}
            onUpdate={debugAwareUpdate}
            fieldEditor={fieldEditor}
            valueBar={valueBar}
          />
        }
        footer={embedded ? undefined : <KeyboardShortcutsButton context={footerContext} />}
        layout={registerLayout}
        visualizerPaneClassName="register-visualizer-pane-compact"
      />
    );
  }
);

RegisterEditor.displayName = 'RegisterEditor';
