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
  ({ register, fields, registerLayout, toggleRegisterLayout, selectionMeta, onUpdate }, ref) => {
    const registerSize = register?.size ?? 32;

    const fieldEditor = useFieldEditor(fields, registerSize, onUpdate, true);

    const { hoveredFieldIndex, setHoveredFieldIndex, setDragPreviewRanges, focusRef } = fieldEditor;

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
        onUpdate(['fields'], newFields);
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
    };

    return (
      <TwoPanelEditorLayout
        header={
          <EditorHeader
            title={register.name ?? ''}
            description={register.description}
            layout={registerLayout}
            onToggleLayout={toggleRegisterLayout}
          />
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
        footer={<KeyboardShortcutsButton context="register" />}
        layout={registerLayout}
      />
    );
  }
);

RegisterEditor.displayName = 'RegisterEditor';
