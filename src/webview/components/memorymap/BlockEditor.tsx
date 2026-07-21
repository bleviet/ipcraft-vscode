import React, { useCallback, useRef, useState } from 'react';
import type { YamlUpdateHandler, BitFieldRecord } from '../../types/editor';
import { KeyboardShortcutsButton, EditorHeader, CellInput } from '../../shared/components';
import type { RegisterModel } from '../../types/registerModel';
import type { RegisterDef } from '../../types/memoryMap';
import { toHex } from '../../utils/formatUtils';
import { validateUniqueName } from '../../shared/utils/validation';
import { useCellEditGuard } from '../../hooks/useCellEditGuard';
import { RegisterEditor } from '../register/RegisterEditor';

export interface AddressBlockModel {
  name?: string;
  baseAddress?: number | string;
  description?: string;
  usage?: string;
  registers?: RegisterModel[];
  [key: string]: unknown;
}

export interface BlockEditorProps {
  /** The address block object (has name, baseAddress, registers, etc.). */
  block: AddressBlockModel;
  /** Bit-field detail layout for the selected register (pro vs. stacked). */
  registerLayout: 'stacked' | 'side-by-side';
  toggleRegisterLayout: () => void;
  selectionMeta?: {
    absoluteAddress?: number;
    relativeOffset?: number;
    focusDetails?: boolean;
    activeRegisterIndex?: number;
  };
  onUpdate: YamlUpdateHandler;
  /** Navigates into a register array element (arrays get their own editor). */
  onNavigateToRegister?: (regIndex: number) => void;
}

/** A register array (nested or flat) is edited in its own dedicated view. */
function isArrayReg(reg?: RegisterModel): boolean {
  return (
    !!reg &&
    (reg.__kind === 'array' || (typeof reg.count === 'number' && typeof reg.stride === 'number'))
  );
}

type InlineEditKey = 'name' | 'offset' | 'description';

/**
 * Compact, editable identity strip for the register currently shown in the
 * detail pane below (name / offset / description) — the register list itself
 * is selected, inserted, deleted and reordered from the Outline panel, but
 * those three fields have no other editable home once a register is open.
 * Keyed by regIndex from the caller so switching registers resets edit state.
 */
function RegisterInlineHeader({
  reg,
  regIndex,
  registers,
  onUpdate,
}: {
  reg: RegisterModel;
  regIndex: number;
  registers: RegisterModel[];
  onUpdate: YamlUpdateHandler;
}) {
  const [editingKey, setEditingKey] = useState<InlineEditKey | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const offset = Number(reg.offset ?? 0);

  const { cancelEditRef, captureEditSnapshot } = useCellEditGuard<RegisterModel>({
    rows: registers,
    rowsPath: ['registers'],
    onUpdate,
    containerRef: containerRef as React.RefObject<HTMLElement>,
  });

  const startEdit = (key: InlineEditKey) => (e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingKey(key);
  };

  const stopEdit = () => setEditingKey(null);

  const commitName = (value: string) => {
    const siblingNames = registers
      .filter((_, i) => i !== regIndex)
      .map((r) => String(r.name ?? ''));
    const err = validateUniqueName(value, siblingNames, reg.name ?? '');
    setNameError(err);
    if (!err) {
      onUpdate(['registers', regIndex, 'name'], value);
    }
  };

  return (
    <div
      ref={containerRef}
      className="vscode-surface border-b vscode-border px-6 py-2 shrink-0 flex items-center gap-4 min-w-0"
      onBlur={(e) => {
        if (!containerRef.current?.contains(e.relatedTarget as Node)) {
          stopEdit();
        }
      }}
    >
      {editingKey === 'name' ? (
        <CellInput
          editKey="name"
          className="font-mono font-bold text-sm w-48 shrink-0"
          isEditing
          value={reg.name ?? ''}
          onFocus={() => captureEditSnapshot()}
          cancelEditRef={cancelEditRef}
          onInput={commitName}
          onBlur={(value) => {
            commitName(value);
            setNameError(null);
          }}
        />
      ) : (
        <span
          className="font-mono font-bold text-sm shrink-0 cursor-text"
          data-tooltip="Double-click to edit"
          onDoubleClick={startEdit('name')}
        >
          {reg.name}
        </span>
      )}
      {nameError ? <span className="text-[11px] vscode-error shrink-0">{nameError}</span> : null}

      <span className="text-xs vscode-muted font-mono flex items-center gap-1 shrink-0">
        Offset:
        {editingKey === 'offset' ? (
          <CellInput
            editKey="offset"
            className="w-20 font-mono"
            isEditing
            value={toHex(offset)}
            onFocus={() => captureEditSnapshot()}
            cancelEditRef={cancelEditRef}
            onInput={(value) => {
              const val = Number(value);
              if (!Number.isNaN(val)) {
                onUpdate(['registers', regIndex, 'offset'], val);
              }
            }}
            onBlur={stopEdit}
          />
        ) : (
          <span
            className="cursor-text"
            data-tooltip="Double-click to edit"
            onDoubleClick={startEdit('offset')}
          >
            {toHex(offset)}
          </span>
        )}
      </span>

      <span className="flex-1 min-w-0 text-xs vscode-muted">
        {editingKey === 'description' ? (
          <CellInput
            editKey="description"
            className="w-full text-xs"
            isEditing
            value={reg.description ?? ''}
            onFocus={() => captureEditSnapshot()}
            cancelEditRef={cancelEditRef}
            onInput={(value) => onUpdate(['registers', regIndex, 'description'], value)}
            onBlur={stopEdit}
          />
        ) : (
          <span
            className="cursor-text truncate block"
            data-tooltip="Double-click to edit"
            onDoubleClick={startEdit('description')}
          >
            {reg.description?.length ? (
              reg.description
            ) : (
              <span className="italic opacity-60">No description</span>
            )}
          </span>
        )}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Detail editor for a single address block's active register: an editable
 * identity strip (name/offset/description) plus the selected register's
 * BitFieldVisualizer + FieldsTable (an embedded RegisterEditor). The register
 * list itself — select, insert, delete, reorder, rename — lives entirely in
 * the Outline panel; register arrays route to their own editor.
 */
export function BlockEditor({
  block,
  registerLayout,
  toggleRegisterLayout,
  selectionMeta,
  onUpdate,
  onNavigateToRegister,
}: BlockEditorProps) {
  const registers = block?.registers ?? [];
  const baseAddress = Number(block?.baseAddress ?? 0);

  // The active register is driven entirely by the Outline's selection; there
  // is no local list state to reconcile (insert/delete/reorder all happen in
  // the Outline, which re-derives this index fresh after every edit).
  const selectedIndex =
    registers.length === 0
      ? -1
      : Math.min(Math.max(selectionMeta?.activeRegisterIndex ?? 0, 0), registers.length - 1);
  const activeReg = selectedIndex >= 0 ? registers[selectedIndex] : undefined;

  // ---- Register-scoped update handler for the embedded field detail ----
  const detailUpdate: YamlUpdateHandler = useCallback(
    (p, v) => {
      if (selectedIndex < 0) {
        return;
      }
      if (p[0] === '__op') {
        onUpdate(p, { ...(v as Record<string, unknown>), __regIndex: selectedIndex });
      } else {
        onUpdate(['registers', selectedIndex, ...p], v);
      }
    },
    [onUpdate, selectedIndex]
  );

  let detail: React.ReactNode;
  if (!activeReg) {
    detail = (
      <div className="flex items-center justify-center h-full vscode-muted text-sm px-6 text-center">
        {registers.length === 0
          ? 'No registers yet. Select this block in the outline and press o to add one.'
          : 'Select a register to edit its fields.'}
      </div>
    );
  } else if (isArrayReg(activeReg)) {
    detail = (
      <div className="flex flex-col items-center justify-center h-full gap-3 vscode-muted text-sm px-6 text-center">
        <span className="codicon codicon-symbol-array text-3xl opacity-60" />
        <div>
          <span className="font-mono font-semibold">{activeReg.name}</span> is a register array.
        </div>
        {onNavigateToRegister && (
          <button
            className="px-3 py-1.5 rounded"
            style={{
              background: 'var(--vscode-button-background)',
              color: 'var(--vscode-button-foreground)',
              border: 'none',
              cursor: 'pointer',
            }}
            onClick={() => onNavigateToRegister(selectedIndex)}
          >
            Open array editor
          </button>
        )}
      </div>
    );
  } else {
    detail = (
      <RegisterEditor
        register={activeReg as unknown as RegisterDef}
        fields={(activeReg.fields ?? []) as BitFieldRecord[]}
        registerLayout={registerLayout}
        toggleRegisterLayout={toggleRegisterLayout}
        onUpdate={detailUpdate}
        title={activeReg.name}
        embedded
      />
    );
  }

  return (
    <div className="flex flex-col w-full h-full min-h-0">
      <EditorHeader
        title={block?.name ?? 'Address Block'}
        description={`${block?.description ?? `Base: ${toHex(baseAddress)}`} • ${block?.usage ?? 'register'}`}
        layout={registerLayout}
        onToggleLayout={toggleRegisterLayout}
      />
      {activeReg && (
        <RegisterInlineHeader
          key={selectedIndex}
          reg={activeReg}
          regIndex={selectedIndex}
          registers={registers}
          onUpdate={onUpdate}
        />
      )}
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden vscode-surface">{detail}</div>
      <KeyboardShortcutsButton context="register" />
    </div>
  );
}
