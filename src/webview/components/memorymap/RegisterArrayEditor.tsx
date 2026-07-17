import React, { useCallback, useRef, useState } from 'react';
import type { YamlUpdateHandler, BitFieldRecord } from '../../types/editor';
import { VSCodeTextField } from '@vscode/webview-ui-toolkit/react';
import { KeyboardShortcutsButton, EditorHeader, CellInput } from '../../shared/components';
import type { RegisterModel } from '../../types/registerModel';
import type { RegisterDef } from '../../types/memoryMap';
import { toHex } from '../../utils/formatUtils';
import { validateUniqueName } from '../../shared/utils/validation';
import { useCellEditGuard } from '../../hooks/useCellEditGuard';
import { useEditableDraft } from '../../shared/hooks/useEditableDraft';
import { RegisterEditor } from '../register/RegisterEditor';

export interface RegisterArrayEditorProps {
  /** The register array definition object. */
  registerArray: RegisterModel;
  arrayLayout: 'stacked' | 'side-by-side';
  toggleArrayLayout: () => void;
  selectionMeta?: {
    absoluteAddress?: number;
    relativeOffset?: number;
    focusDetails?: boolean;
    activeRegisterIndex?: number;
  };
  onUpdate: YamlUpdateHandler;
}

type InlineEditKey = 'name' | 'offset' | 'description';

/**
 * Compact, editable identity strip for the template register currently shown
 * in the detail pane below (name / offset / description) — the register list
 * itself is selected, inserted, deleted and reordered from the Outline panel
 * (every array element shares this one template), but those three fields
 * have no other editable home once a register is open. Keyed by regIndex
 * from the caller so switching registers resets edit state.
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
  const offset = Number(reg.address_offset ?? reg.offset ?? 0);

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
 * Renders and manages editing of a register array definition:
 * - Array name, base offset, count, stride (header)
 * - Flat arrays reuse the register bit-field editor directly.
 * - Register groups (nested registers) show an editable identity strip plus
 *   the selected template register's BitFieldVisualizer + FieldsTable. The
 *   template register list itself — select, insert, delete, reorder, rename
 *   — lives entirely in the Outline panel (every array element shares one
 *   template).
 */
export function RegisterArrayEditor({
  registerArray,
  arrayLayout,
  toggleArrayLayout,
  selectionMeta,
  onUpdate,
}: RegisterArrayEditorProps) {
  const arr = registerArray;
  const nestedRegisters = arr?.registers ?? [];
  const baseOffset = arr?.offset ?? arr?.address_offset ?? 0;
  const baseAddress = selectionMeta?.absoluteAddress ?? Number(baseOffset);

  // A flat register array (count/stride + fields, no nested registers) is a
  // single register template replicated N times: it gets the same bit-field
  // editor a normal register does. Register groups (nested registers) keep
  // the master-detail view below.
  const isFlatArray = nestedRegisters.length === 0;

  // Local drafts keep the caret stable in the header fields (see hook).
  const nameDraft = useEditableDraft(arr?.name ?? '');
  const countDraft = useEditableDraft(String(arr?.count ?? 1));
  const strideDraft = useEditableDraft(String(arr?.stride ?? 4));

  // The active template register is driven entirely by the Outline's
  // selection; there is no local list state to reconcile (insert/delete/
  // reorder all happen in the Outline, which re-derives this index fresh
  // after every edit).
  const selectedIndex = isFlatArray
    ? -1
    : Math.min(Math.max(selectionMeta?.activeRegisterIndex ?? 0, 0), nestedRegisters.length - 1);
  const activeReg = selectedIndex >= 0 ? nestedRegisters[selectedIndex] : undefined;

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

  const headerChildren = (
    <>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 vscode-surface-alt p-4 rounded-lg mt-3">
        <div>
          <label className="text-xs vscode-muted block mb-1">Name</label>
          <VSCodeTextField
            value={nameDraft.draft}
            onFocus={nameDraft.markFocused}
            onBlur={nameDraft.markBlurred}
            onInput={(e: Event | React.FormEvent<HTMLElement>) => {
              const next = (e.target as HTMLInputElement).value;
              nameDraft.setDraft(next);
              onUpdate(['name'], next);
            }}
            className="vscode-field-bare w-full"
          />
        </div>
        <div>
          <label className="text-xs vscode-muted block mb-1">Base Address</label>
          <span className="font-mono text-sm">{toHex(baseAddress)}</span>
        </div>
        <div>
          <label className="text-xs vscode-muted block mb-1">Count</label>
          <VSCodeTextField
            value={countDraft.draft}
            onFocus={countDraft.markFocused}
            onBlur={countDraft.markBlurred}
            onInput={(e: Event | React.FormEvent<HTMLElement>) => {
              const raw = (e.target as HTMLInputElement).value;
              countDraft.setDraft(raw);
              const val = parseInt(raw, 10);
              if (!isNaN(val) && val > 0) {
                onUpdate(['count'], val);
              }
            }}
            className="vscode-field-bare w-24"
          />
        </div>
        <div>
          <label className="text-xs vscode-muted block mb-1">Stride (bytes)</label>
          <VSCodeTextField
            value={strideDraft.draft}
            onFocus={strideDraft.markFocused}
            onBlur={strideDraft.markBlurred}
            onInput={(e: Event | React.FormEvent<HTMLElement>) => {
              const raw = (e.target as HTMLInputElement).value;
              strideDraft.setDraft(raw);
              const val = parseInt(raw, 10);
              if (!isNaN(val) && val > 0) {
                onUpdate(['stride'], val);
              }
            }}
            className="vscode-field-bare w-24"
          />
        </div>
      </div>
      <div className="text-sm vscode-muted mt-2 mb-1">
        <span className="font-mono">
          {toHex(baseAddress)} &rarr;{' '}
          {toHex(baseAddress + Number(arr?.count ?? 1) * Number(arr?.stride ?? 4) - 1)}
        </span>
        <span className="ml-2">({(arr?.count ?? 1) * (arr?.stride ?? 4)} bytes total)</span>
      </div>
    </>
  );

  // Flat array: reuse the register bit-field editor, keeping the array
  // dimension controls (name/count/stride) in the header.
  if (isFlatArray) {
    return (
      <RegisterEditor
        register={arr as unknown as RegisterDef}
        fields={(arr?.fields ?? []) as BitFieldRecord[]}
        registerLayout={arrayLayout}
        toggleRegisterLayout={toggleArrayLayout}
        selectionMeta={selectionMeta}
        onUpdate={onUpdate}
        title={arr?.name ?? 'Register Array'}
        headerChildren={headerChildren}
        footerContext="array"
      />
    );
  }

  return (
    <div className="flex flex-col w-full h-full min-h-0">
      <EditorHeader
        title={arr?.name ?? 'Register Array'}
        description={`${arr?.description ?? 'Register array'} • ${arr?.count ?? 1} instances × ${arr?.stride ?? 4} bytes`}
        layout={arrayLayout}
        onToggleLayout={toggleArrayLayout}
      >
        {headerChildren}
      </EditorHeader>
      {activeReg && (
        <RegisterInlineHeader
          key={selectedIndex}
          reg={activeReg}
          regIndex={selectedIndex}
          registers={nestedRegisters}
          onUpdate={onUpdate}
        />
      )}
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden vscode-surface">
        {activeReg ? (
          <RegisterEditor
            register={activeReg as unknown as RegisterDef}
            fields={(activeReg.fields ?? []) as BitFieldRecord[]}
            registerLayout={arrayLayout}
            toggleRegisterLayout={toggleArrayLayout}
            onUpdate={detailUpdate}
            title={activeReg.name}
            embedded
          />
        ) : (
          <div className="flex items-center justify-center h-full vscode-muted text-sm px-6 text-center">
            Select a register to edit its fields.
          </div>
        )}
      </div>
      <KeyboardShortcutsButton context="register" />
    </div>
  );
}
