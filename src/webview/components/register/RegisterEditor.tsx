import React, { useEffect, useImperativeHandle, useMemo } from 'react';
import type { YamlUpdateHandler, BitFieldRecord } from '../../types/editor';
import BitFieldVisualizer from '../BitFieldVisualizer';
import { KeyboardShortcutsButton } from '../../shared/components';
import { FieldsTable } from './FieldsTable';
import { useFieldEditor } from '../../hooks/useFieldEditor';
import type { Register } from '../../types/memoryMap';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RegisterEditorProps {
  /** The register to display and edit. */
  register: Register;
  /** Normalised bit fields (with bit_range / bit_offset / bit_width). */
  fields: BitFieldRecord[];
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
  ({ register, fields, selectionMeta, onUpdate }, ref) => {
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

    // Normalise fields for BitFieldVisualizer (provide bit_range).
    const normalisedFields = useMemo(() => {
      if (!register?.fields) {
        return [];
      }
      return register.fields.map((f: BitFieldRecord) => {
        const mappedF = {
          ...f,
          name: f.name ?? undefined,
          bits: f.bits ?? undefined,
          bit_offset: f.bit_offset ?? undefined,
          bit_width: f.bit_width ?? undefined,
          access: f.access ?? undefined,
          reset_value: f.reset_value ?? undefined,
          description: f.description ?? undefined,
        };
        if (mappedF.bit_range) {
          const validRange: [number, number] = [mappedF.bit_range[0], mappedF.bit_range[1]];
          return { ...mappedF, bit_range: validRange };
        }
        if (mappedF.bit_offset !== undefined && mappedF.bit_width !== undefined) {
          const lo = Number(mappedF.bit_offset);
          const width = Number(mappedF.bit_width);
          const hi = lo + width - 1;
          return { ...mappedF, bit_range: [hi, lo] as [number, number] };
        }
        return mappedF;
      });
    }, [register?.fields]);

    return (
      <div className="flex flex-col w-full h-full min-h-0">
        {/* Register Header + BitFieldVisualizer */}
        <div className="vscode-surface border-b vscode-border p-8 flex flex-col gap-6 shrink-0 relative overflow-hidden">
          <div className="flex justify-between items-start relative z-10">
            <div>
              <h2 className="text-2xl font-bold font-mono tracking-tight">{register.name}</h2>
              <p className="vscode-muted text-sm mt-1 max-w-2xl">{register.description}</p>
            </div>
          </div>
          <div className="w-full relative z-10 mt-2 select-none">
            <BitFieldVisualizer
              fields={normalisedFields}
              hoveredFieldIndex={hoveredFieldIndex}
              setHoveredFieldIndex={setHoveredFieldIndex}
              registerSize={32}
              layout="pro"
              onUpdateFieldReset={(fieldIndex, resetValue) => {
                onUpdate(['fields', fieldIndex, 'reset_value'], resetValue);
              }}
              onUpdateFieldRange={(fieldIndex, newRange) => {
                const [hi, lo] = newRange;
                const field = fields[fieldIndex];
                const updatedField = {
                  ...field,
                  bit_range: newRange,
                  bit_offset: lo,
                  bit_width: hi - lo + 1,
                };
                const newFields = [...fields];
                newFields[fieldIndex] = updatedField;
                onUpdate(['fields'], newFields);
              }}
              onBatchUpdateFields={(updates) => {
                const newFields = [...fields];
                updates.forEach(({ idx, range }) => {
                  const [hi, lo] = range;
                  const field = newFields[idx];
                  if (field) {
                    newFields[idx] = {
                      ...field,
                      bit_range: range,
                      bit_offset: lo,
                      bit_width: hi - lo + 1,
                    };
                  }
                });
                newFields.sort((a, b) => {
                  const aLo = a.bit_range ? a.bit_range[1] : (a.bit_offset ?? 0);
                  const bLo = b.bit_range ? b.bit_range[1] : (b.bit_offset ?? 0);
                  return aLo - bLo;
                });
                onUpdate(['fields'], newFields);
              }}
              onCreateField={(newField) => {
                let maxN = 0;
                for (const f of fields) {
                  const m = String(f.name ?? '').match(/^field(\d+)$/);
                  if (m) {
                    maxN = Math.max(maxN, parseInt(m[1], 10));
                  }
                }
                const name = `field${maxN + 1}`;
                const [hi, lo] = newField.bit_range;
                const field = {
                  name,
                  bit_range: newField.bit_range,
                  bit_offset: lo,
                  bit_width: hi - lo + 1,
                  access: 'read-write',
                  reset_value: 0,
                  description: '',
                };
                const newFields = [...fields, field].sort((a, b) => {
                  const aLo = a.bit_range ? a.bit_range[1] : (a.bit_offset ?? 0);
                  const bLo = b.bit_range ? b.bit_range[1] : (b.bit_offset ?? 0);
                  return aLo - bLo;
                });
                onUpdate(['fields'], newFields);
              }}
              onDragPreview={(preview) => {
                if (preview === null) {
                  setDragPreviewRanges({});
                } else {
                  const newRanges: Record<number, [number, number]> = {};
                  preview.forEach(({ idx, range }) => {
                    newRanges[idx] = range;
                  });
                  setDragPreviewRanges(newRanges);
                }
              }}
            />
          </div>
        </div>

        {/* Editable fields table */}
        <FieldsTable
          fields={fields}
          registerSize={registerSize}
          onUpdate={onUpdate}
          fieldEditor={fieldEditor}
        />

        <KeyboardShortcutsButton context="register" />
      </div>
    );
  }
);

RegisterEditor.displayName = 'RegisterEditor';
