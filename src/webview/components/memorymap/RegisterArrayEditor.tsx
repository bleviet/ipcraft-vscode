import React, { useEffect, useRef, useState } from 'react';
import type { YamlUpdateHandler } from '../../types/editor';
import { VSCodeTextField } from '@vscode/webview-ui-toolkit/react';
import {
  KeyboardShortcutsButton,
  EditorHeader,
  TwoPanelEditorLayout,
} from '../../shared/components';
import RegisterMapVisualizer from '../RegisterMapVisualizer';
import type { RegisterModel } from '../../types/registerModel';
import { FIELD_COLOR_KEYS } from '../../shared/colors';
import { toHex } from '../../utils/formatUtils';
import { generateUniqueName } from '../../utils/naming';
import { useTableEditorState } from '../../hooks/useTableEditorState';
import { useEditableDraft } from '../../shared/hooks/useEditableDraft';
import { RegisterTableRow, REG_COLUMN_ORDER } from './RegisterTableRow';
import type { RegEditKey } from './RegisterTableRow';
import { reconcileRowIds, type TableRowWrapper } from '../../utils/rowIdentity';
import { RegisterEditor } from '../register/RegisterEditor';
import type { RegisterDef } from '../../types/memoryMap';
import type { BitFieldRecord } from '../../types/editor';

interface DragState {
  active: boolean;
  fromRowId: string | null;
  toRowId: string | null;
}

const DRAG_IDLE: DragState = { active: false, fromRowId: null, toRowId: null };

export interface RegisterArrayEditorProps {
  /** The register array definition object. */
  registerArray: RegisterModel;
  arrayLayout: 'stacked' | 'side-by-side';
  toggleArrayLayout: () => void;
  onUpdate: YamlUpdateHandler;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Renders and manages editing of a register array definition:
 * - Array name, base offset, count, stride
 * - Inline RegisterMapVisualizer for nested template registers
 * - Keyboard-navigable nested registers table
 */
export function RegisterArrayEditor({
  registerArray,
  arrayLayout,
  toggleArrayLayout,
  onUpdate,
}: RegisterArrayEditorProps) {
  const arr = registerArray;
  const nestedRegisters = arr?.registers ?? [];
  const baseOffset = arr?.offset ?? arr?.address_offset ?? 0;

  // A flat register array (count/stride + fields, no nested registers) is a
  // single register template replicated N times: it gets the same bit-field
  // editor a normal register does. Register groups (nested registers) keep the
  // nested-registers table below.
  const isFlatArray = nestedRegisters.length === 0;

  // Local drafts keep the caret stable in the header fields (see hook).
  const nameDraft = useEditableDraft(arr?.name ?? '');
  const countDraft = useEditableDraft(String(arr?.count ?? 1));
  const strideDraft = useEditableDraft(String(arr?.stride ?? 4));

  const tbodyRef = useRef<HTMLTableSectionElement | null>(null);

  // ---- wrapped rows for row identity ----
  const [wrappedRegisters, setWrappedRegisters] = useState<Array<TableRowWrapper<RegisterModel>>>(
    []
  );

  useEffect(() => {
    setWrappedRegisters((prev) => reconcileRowIds(prev, nestedRegisters));
  }, [nestedRegisters]);

  // ---- drag-to-reorder ----
  const [dragState, setDragState] = useState<DragState>(DRAG_IDLE);

  const handleDragHandlePointerDown = (rowId: string, e: React.PointerEvent) => {
    if (e.button !== 0) {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    setDragState({ active: true, fromRowId: rowId, toRowId: rowId });
  };

  const handleDragEnterRow = (rowId: string) => {
    if (!dragState.active) {
      return;
    }
    setDragState((prev) => ({ ...prev, toRowId: rowId }));
  };

  useEffect(() => {
    if (!dragState.active) {
      return;
    }
    const commit = () => {
      const { fromRowId, toRowId } = dragState;
      if (fromRowId && toRowId && fromRowId !== toRowId) {
        const fromIdx = wrappedRegisters.findIndex((w) => w.rowId === fromRowId);
        const toIdx = wrappedRegisters.findIndex((w) => w.rowId === toRowId);
        if (fromIdx >= 0 && toIdx >= 0) {
          const newRegs = [...nestedRegisters];
          const [moved] = newRegs.splice(fromIdx, 1);
          newRegs.splice(toIdx, 0, moved);
          onUpdate(['registers'], newRegs as unknown[]);
        }
      }
      setDragState(DRAG_IDLE);
    };
    const cancel = () => setDragState(DRAG_IDLE);
    window.addEventListener('pointerup', commit);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('blur', cancel);
    return () => {
      window.removeEventListener('pointerup', commit);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('blur', cancel);
    };
  }, [dragState, wrappedRegisters, nestedRegisters, onUpdate]);

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
    rowSelectorAttr: 'data-row-id',
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
      const nextRow = rowIndex > 0 ? rowIndex - 1 : newRegs.length > 0 ? 0 : -1;
      window.setTimeout(() => {
        editor.selectRow(nextRow);
      }, 0);
    },
    enableHoverInsert: false,
    clampDeps: [arr?.name],
  });

  const getRegColor = (i: number) => FIELD_COLOR_KEYS[i % FIELD_COLOR_KEYS.length];

  const visualizer = (
    <RegisterMapVisualizer
      registers={nestedRegisters}
      hoveredRegIndex={editor.hoveredIndex}
      setHoveredRegIndex={editor.setHoveredFieldIndex}
      baseAddress={0}
      onReorderRegisters={(newRegs) => onUpdate(['registers'], newRegs)}
      onRegisterClick={(idx) => editor.selectRow(idx)}
      onDeleteReg={(idx) => {
        const rowId = wrappedRegisters[idx]?.rowId;
        if (rowId) {
          const rowIndex = wrappedRegisters.findIndex((w) => w.rowId === rowId);
          if (rowIndex >= 0) {
            const newRegs = nestedRegisters.filter((_, i) => i !== rowIndex);
            onUpdate(['registers'], newRegs);
            const nextRow = rowIndex > 0 ? rowIndex - 1 : newRegs.length > 0 ? 0 : -1;
            window.setTimeout(() => {
              editor.selectRow(nextRow);
            }, 0);
          }
        }
      }}
      layout={arrayLayout === 'side-by-side' ? 'vertical' : 'horizontal'}
    />
  );

  const registersTable = (
    <div
      ref={editor.containerRef as React.RefObject<HTMLDivElement>}
      tabIndex={0}
      data-registers-table="true"
      className={`flex-1 overflow-auto min-h-0 outline-none focus:outline-none${dragState.active ? ' cursor-grabbing select-none' : ''}`}
    >
      <table className="w-full text-left border-collapse table-fixed">
        <colgroup>
          <col className="w-8" />
          <col className="w-[25%] min-w-[160px]" />
          <col className="w-[14%] min-w-[100px]" />
          <col className="w-[20%] min-w-[140px]" />
          <col className="w-[41%]" />
        </colgroup>
        <thead className="vscode-surface-alt text-xs font-semibold vscode-muted uppercase tracking-wider sticky top-0 z-10 shadow-sm">
          <tr className="h-12">
            <th className="w-8 border-b vscode-border" />
            <th className="px-6 py-3 border-b vscode-border align-middle">Name</th>
            <th className="px-4 py-3 border-b vscode-border align-middle">Offset</th>
            <th className="px-4 py-3 border-b vscode-border align-middle">Address Range</th>
            <th className="px-6 py-3 border-b vscode-border align-middle">Description</th>
          </tr>
        </thead>
        <tbody ref={tbodyRef} className="divide-y vscode-border text-sm">
          {wrappedRegisters.map((wrapped: TableRowWrapper<RegisterModel>, idx: number) => (
            <RegisterTableRow
              key={wrapped.rowId}
              reg={wrapped.model}
              rowId={wrapped.rowId}
              idx={idx}
              isSelected={editor.selectedRowId === wrapped.rowId}
              isHovered={editor.hoveredRowId === wrapped.rowId}
              regActiveCell={editor.activeCell}
              color={getRegColor(idx)}
              cancelEditRef={editor.cancelEditRef}
              captureEditSnapshot={editor.captureEditSnapshot}
              onUpdate={onUpdate}
              onRowClick={() => editor.handleRowClick(idx)}
              onCellClick={(key) => editor.handleCellClick(idx, key)}
              onMouseEnter={() => editor.setHoveredRowId(wrapped.rowId)}
              onMouseLeave={editor.handleMouseLeave}
              isDragSource={dragState.active && dragState.fromRowId === wrapped.rowId}
              isDragTarget={
                dragState.active &&
                dragState.toRowId === wrapped.rowId &&
                dragState.fromRowId !== wrapped.rowId
              }
              onDragHandlePointerDown={(e) => handleDragHandlePointerDown(wrapped.rowId, e)}
              onPointerEnterRow={() => handleDragEnterRow(wrapped.rowId)}
              siblingNames={nestedRegisters
                .filter((_: RegisterModel, i: number) => i !== idx)
                .map((r: RegisterModel) => String(r.name ?? ''))}
            />
          ))}
          {nestedRegisters.length === 0 && (
            <tr>
              <td colSpan={4} className="px-4 py-8 text-center vscode-muted">
                No nested registers. Press <kbd className="px-1 rounded vscode-surface-alt">o</kbd>{' '}
                to add one.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
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
            className="w-full"
          />
        </div>
        <div>
          <label className="text-xs vscode-muted block mb-1">Base Offset</label>
          <span className="font-mono text-sm">{toHex(Number(baseOffset))}</span>
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
            className="w-24"
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
            className="w-24"
          />
        </div>
      </div>
      <div className="text-sm vscode-muted mt-2 mb-1">
        <span className="font-mono">
          {toHex(Number(baseOffset))} →{' '}
          {toHex(Number(baseOffset) + Number(arr?.count ?? 1) * Number(arr?.stride ?? 4) - 1)}
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
        onUpdate={onUpdate}
        title={arr?.name ?? 'Register Array'}
        headerChildren={headerChildren}
        footerContext="array"
      />
    );
  }

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
      visualizer={visualizer}
      table={registersTable}
      footer={<KeyboardShortcutsButton context="array" />}
      layout={arrayLayout}
    />
  );
}
