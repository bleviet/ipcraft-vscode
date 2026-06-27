import React, { useEffect, useImperativeHandle, useMemo } from 'react';
import type { YamlUpdateHandler, BitFieldRecord } from '../../types/editor';
import BitFieldVisualizer from '../BitFieldVisualizer';
import {
  KeyboardShortcutsButton,
  EditorHeader,
  TwoPanelEditorLayout,
} from '../../shared/components';
import { FieldsTable } from './FieldsTable';
import { useFieldEditor } from '../../hooks/useFieldEditor';
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

    const fieldEditor = useFieldEditor(fields, registerSize, onUpdate, true);

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
      if (!register?.fields) {
        return [];
      }
      return register.fields.map((f: BitFieldRecord) => {
        const mappedF = {
          ...f,
          name: f.name ?? undefined,
          bits: f.bits ?? undefined,
          offset: f.offset ?? undefined,
          width: f.width ?? undefined,
          access: f.access ?? undefined,
          resetValue: f.resetValue ?? undefined,
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
    }, [register?.fields]);

    const visualizerProps = {
      fields: normalisedFields,
      hoveredFieldIndex,
      setHoveredFieldIndex,
      registerSize,
      onUpdateFieldReset: (fieldIndex: number, resetValue: number | null) => {
        onUpdate(['fields', fieldIndex, 'resetValue'], resetValue);
      },
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
        onUpdate(['fields'], newFields);
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
        onUpdate(['fields'], newFields);
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
        onUpdate(['fields'], newFields);
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
            fields={fields}
            registerSize={registerSize}
            onUpdate={onUpdate}
            fieldEditor={fieldEditor}
          />
        }
        footer={embedded ? undefined : <KeyboardShortcutsButton context={footerContext} />}
        layout={registerLayout}
      />
    );
  }
);

RegisterEditor.displayName = 'RegisterEditor';
