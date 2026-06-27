import React, { useCallback, useEffect, useState } from 'react';
import type { YamlUpdateHandler, BitFieldRecord } from '../../types/editor';
import { VSCodeTextField } from '@vscode/webview-ui-toolkit/react';
import {
  KeyboardShortcutsButton,
  EditorHeader,
  TwoPanelEditorLayout,
} from '../../shared/components';
import RegisterMapVisualizer from '../RegisterMapVisualizer';
import type { RegisterModel } from '../../types/registerModel';
import type { RegisterDef } from '../../types/memoryMap';
import { toHex } from '../../utils/formatUtils';
import { generateUniqueName } from '../../utils/naming';
import { useTableEditorState } from '../../hooks/useTableEditorState';
import { useAutoFocus } from '../../hooks/useAutoFocus';
import { useEditableDraft } from '../../shared/hooks/useEditableDraft';
import { REG_COLUMN_ORDER, type RegEditKey } from './RegisterTableRow';
import { reconcileRowIds, type TableRowWrapper } from '../../utils/rowIdentity';
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

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Renders and manages editing of a register array definition:
 * - Array name, base offset, count, stride (header)
 * - Flat arrays reuse the register bit-field editor directly.
 * - Register groups (nested registers) use a master-detail: an editable rail of
 *   nested-register cards plus the selected register's BitFieldVisualizer +
 *   FieldsTable.
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
  // editor a normal register does. Register groups (nested registers) keep the
  // master-detail rail below.
  const isFlatArray = nestedRegisters.length === 0;

  // Local drafts keep the caret stable in the header fields (see hook).
  const nameDraft = useEditableDraft(arr?.name ?? '');
  const countDraft = useEditableDraft(String(arr?.count ?? 1));
  const strideDraft = useEditableDraft(String(arr?.stride ?? 4));

  // ---- wrapped rows for row identity ----
  const [wrappedRegisters, setWrappedRegisters] = useState<Array<TableRowWrapper<RegisterModel>>>(
    []
  );

  useEffect(() => {
    setWrappedRegisters((prev) => reconcileRowIds(prev, nestedRegisters));
  }, [nestedRegisters]);

  // -- Shared table orchestration --
  const insertNestedReg = (newIdx: number) => {
    const newName = generateUniqueName(nestedRegisters, 'reg');
    const selIdx = editor.selectedIndex >= 0 ? editor.selectedIndex : nestedRegisters.length - 1;
    const selected = nestedRegisters[selIdx];
    const selectedOffset = selected?.address_offset ?? selected?.offset ?? 0;
    const after = newIdx > selIdx;
    const newOffset = after ? Number(selectedOffset) + 4 : Math.max(0, Number(selectedOffset) - 4);

    const newReg = {
      name: newName,
      offset: newOffset,
      address_offset: newOffset,
      description: '',
      fields: [{ name: 'data', bits: '[31:0]', access: 'read-write', description: '' }],
    };

    const newRegs = [...nestedRegisters];
    newRegs.splice(newIdx, 0, newReg);
    onUpdate(['registers'], newRegs as unknown[]);

    window.setTimeout(() => {
      editor.selectRow(newIdx, 'name');
    }, 0);
  };

  const editor = useTableEditorState<RegisterModel, RegEditKey>({
    rows: wrappedRegisters,
    rowsPath: ['registers'],
    columnOrder: REG_COLUMN_ORDER,
    onUpdate,
    rowSelectorAttr: 'data-viz-row',
    onInsertAfter: () => {
      const selIdx = editor.selectedIndex >= 0 ? editor.selectedIndex : nestedRegisters.length - 1;
      insertNestedReg(selIdx + 1);
    },
    onInsertBefore: () => {
      const selIdx = editor.selectedIndex >= 0 ? editor.selectedIndex : 0;
      insertNestedReg(selIdx);
    },
    onDelete: (rowId) => {
      const rowIndex = wrappedRegisters.findIndex((w) => w.rowId === rowId);
      if (rowIndex < 0 || rowIndex >= nestedRegisters.length) {
        return;
      }
      const newRegs = nestedRegisters.filter((_: RegisterModel, i: number) => i !== rowIndex);
      onUpdate(['registers'], newRegs as unknown[]);
      const nextRow = rowIndex < newRegs.length ? rowIndex : newRegs.length - 1;
      window.setTimeout(() => {
        editor.selectRow(nextRow);
      }, 0);
    },
    onMove: (rowId, delta) => {
      const fromIndex = wrappedRegisters.findIndex((w) => w.rowId === rowId);
      const next = fromIndex + delta;
      if (
        fromIndex < 0 ||
        fromIndex >= nestedRegisters.length ||
        next < 0 ||
        next >= nestedRegisters.length
      ) {
        return;
      }
      const newRegs = [...nestedRegisters];
      const temp = newRegs[fromIndex];
      newRegs[fromIndex] = newRegs[next];
      newRegs[next] = temp;
      onUpdate(['registers'], newRegs as unknown[]);
    },
    enableHoverInsert: false,
    clampDeps: [arr?.name],
  });

  useAutoFocus(
    editor.containerRef as React.RefObject<HTMLDivElement>,
    !isFlatArray && !!selectionMeta?.focusDetails,
    [arr?.name]
  );

  // ---- Register-scoped update handler for the embedded field detail ----
  const detailUpdate: YamlUpdateHandler = useCallback(
    (p, v) => {
      const idx = editor.selectedIndex;
      if (idx < 0) {
        return;
      }
      if (p[0] === '__op') {
        onUpdate(p, { ...(v as Record<string, unknown>), __regIndex: idx });
      } else {
        onUpdate(['registers', idx, ...p], v);
      }
    },
    [onUpdate, editor.selectedIndex]
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

  const activeReg = editor.selectedIndex >= 0 ? nestedRegisters[editor.selectedIndex] : undefined;

  const rail = (
    <div
      ref={editor.containerRef as React.RefObject<HTMLDivElement>}
      tabIndex={0}
      data-registers-table="true"
      className="outline-none focus:outline-none"
    >
      <RegisterMapVisualizer
        registers={nestedRegisters}
        hoveredRegIndex={editor.hoveredIndex}
        setHoveredRegIndex={editor.setHoveredFieldIndex}
        selectedRegIndex={editor.selectedIndex}
        onSelectRegister={editor.selectRow}
        baseAddress={baseAddress}
        onReorderRegisters={(newRegs) => onUpdate(['registers'], newRegs)}
        onDeleteReg={(idx) => {
          const rowId = wrappedRegisters[idx]?.rowId;
          if (rowId) {
            const rowIndex = wrappedRegisters.findIndex((w) => w.rowId === rowId);
            if (rowIndex >= 0) {
              const newRegs = nestedRegisters.filter((_, i) => i !== rowIndex);
              onUpdate(['registers'], newRegs);
              const nextRow = rowIndex < newRegs.length ? rowIndex : newRegs.length - 1;
              window.setTimeout(() => {
                editor.selectRow(nextRow);
              }, 0);
            }
          }
        }}
        onUpdateRegister={onUpdate}
        cancelEditRef={editor.cancelEditRef}
        captureEditSnapshot={editor.captureEditSnapshot}
        layout="vertical"
      />
    </div>
  );

  const detail = activeReg ? (
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
      {nestedRegisters.length === 0
        ? 'No nested registers. Press o to add one.'
        : 'Select a register to edit its fields.'}
    </div>
  );

  return (
    <TwoPanelEditorLayout
      header={
        <EditorHeader
          title={arr?.name ?? 'Register Array'}
          description={`${arr?.description ?? 'Register array'} • ${arr?.count ?? 1} instances × ${arr?.stride ?? 4} bytes`}
          layout={arrayLayout}
          onToggleLayout={toggleArrayLayout}
        >
          {headerChildren}
        </EditorHeader>
      }
      visualizer={rail}
      table={detail}
      footer={<KeyboardShortcutsButton context="array" />}
      layout="side-by-side"
    />
  );
}
