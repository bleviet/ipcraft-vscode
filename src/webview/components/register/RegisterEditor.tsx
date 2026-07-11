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
import { useLiveRegisterValuesContext } from '../../hooks/LiveRegisterValuesContext';
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
// Live hardware value badge (issue #36 Part B)
// ---------------------------------------------------------------------------

interface LiveRegisterBadgeProps {
  name: string;
  status: 'idle' | 'reading' | 'value' | 'error';
  value?: number;
  error?: string;
  onRead: () => void;
}

/**
 * "Read from hardware" badge shown above the bit-field visualizer while
 * Debug Mode is on. Deliberately placed in the visualizer slot (not
 * EditorHeader) so it renders both standalone (DetailsPanel) and embedded
 * as a block master-detail pane (BlockEditor, RegisterArrayEditor) — the
 * two register-view contexts that exist today.
 */
function LiveRegisterBadge({ name, status, value, error, onRead }: LiveRegisterBadgeProps) {
  return (
    <div
      className="inline-flex items-center gap-1.5 mx-2 mt-2 px-2 py-0.5 rounded text-[11px] self-start"
      style={{
        background: 'var(--vscode-badge-background)',
        color: 'var(--vscode-badge-foreground)',
      }}
    >
      <button
        onClick={onRead}
        title="Read from hardware"
        aria-label={`Read ${name} from hardware`}
        type="button"
        style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 0 }}
      >
        <span
          className={`codicon codicon-refresh${status === 'reading' ? ' codicon-modifier-spin' : ''}`}
          style={{ fontSize: '12px' }}
        />
      </button>
      {status === 'idle' && <span>Not read from hardware</span>}
      {status === 'reading' && <span>Reading…</span>}
      {status === 'value' && value !== undefined && (
        <span data-testid="live-register-value">Live: 0x{value.toString(16).padStart(8, '0')}</span>
      )}
      {status === 'error' && (
        <span style={{ color: 'var(--vscode-errorForeground)' }}>{error ?? 'Read failed'}</span>
      )}
    </div>
  );
}

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
    const [debugOverrides, setDebugOverrides] = useState<Record<number, number | null>>({});

    // Live hardware register values (issue #36 Part B): a read-only baseline
    // layer under debugOverrides, so a user's own typed exploration value
    // always wins over the last hardware read.
    const { liveValues, requestRead } = useLiveRegisterValuesContext();
    const liveState = register?.name ? liveValues[register.name] : undefined;

    useEffect(() => {
      setDebugOverrides({});
    }, [debugMode, register?.name]);

    const effectiveFields = useMemo(() => {
      if (!debugMode) {
        return fields;
      }
      let result = fields;
      if (liveState?.status === 'value' && liveState.value !== undefined) {
        const liveValue = liveState.value;
        result = result.map((f) => {
          if (
            f.offset === undefined ||
            f.offset === null ||
            f.width === undefined ||
            f.width === null
          ) {
            return f;
          }
          const width = Number(f.width);
          const mask = width >= 32 ? 0xffffffff : (1 << width) - 1;
          const decoded = (liveValue >>> Number(f.offset)) & mask;
          return { ...f, resetValue: decoded };
        });
      }
      if (Object.keys(debugOverrides).length > 0) {
        result = result.map((f, i) =>
          Object.prototype.hasOwnProperty.call(debugOverrides, i)
            ? { ...f, resetValue: debugOverrides[i] }
            : f
        );
      }
      return result;
    }, [fields, debugMode, debugOverrides, liveState]);

    const debugAwareUpdate: YamlUpdateHandler = useCallback(
      (path, value) => {
        if (debugMode) {
          const [seg0, seg1, seg2] = path;
          if (seg0 === 'fields' && typeof seg1 === 'number' && seg2 === 'resetValue') {
            setDebugOverrides((prev) => ({ ...prev, [seg1]: value as number | null }));
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
      return effectiveFields.map((f: BitFieldRecord) => {
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
    }, [effectiveFields]);

    const visualizerProps = {
      fields: normalisedFields,
      hoveredFieldIndex,
      setHoveredFieldIndex,
      registerSize,
      onUpdateFieldReset: (fieldIndex: number, resetValue: number | null) => {
        debugAwareUpdate(['fields', fieldIndex, 'resetValue'], resetValue);
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
          <>
            {debugMode && (
              <LiveRegisterBadge
                name={register.name}
                status={liveState?.status ?? 'idle'}
                value={liveState?.value}
                error={liveState?.error}
                onRead={() => requestRead(register.name)}
              />
            )}
            <BitFieldVisualizer
              {...visualizerProps}
              layout={registerLayout === 'side-by-side' ? 'vertical' : 'pro'}
            />
          </>
        }
        table={
          <FieldsTable
            fields={effectiveFields}
            registerSize={registerSize}
            onUpdate={debugAwareUpdate}
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
