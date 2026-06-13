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
import { RegisterTableRow, REG_COLUMN_ORDER } from './RegisterTableRow';
import type { RegEditKey } from './RegisterTableRow';
import { reconcileRowIds, type TableRowWrapper } from '../../utils/rowIdentity';

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
  const baseOffset = arr?.address_offset ?? 0;

  const tbodyRef = useRef<HTMLTableSectionElement | null>(null);

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
      access: 'read-write',
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
      className="flex-1 overflow-auto min-h-0 outline-none focus:outline-none"
    >
      <table className="w-full text-left border-collapse table-fixed">
        <colgroup>
          <col className="w-[30%] min-w-[200px]" />
          <col className="w-[20%] min-w-[120px]" />
          <col className="w-[15%] min-w-[100px]" />
          <col className="w-[35%]" />
        </colgroup>
        <thead className="vscode-surface-alt text-xs font-semibold vscode-muted uppercase tracking-wider sticky top-0 z-10 shadow-sm">
          <tr className="h-12">
            <th className="px-6 py-3 border-b vscode-border align-middle">Name</th>
            <th className="px-4 py-3 border-b vscode-border align-middle">Offset</th>
            <th className="px-4 py-3 border-b vscode-border align-middle">Access</th>
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
            value={arr?.name ?? ''}
            onInput={(e: Event | React.FormEvent<HTMLElement>) =>
              onUpdate(['name'], (e.target as HTMLInputElement).value)
            }
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
            value={String(arr?.count ?? 1)}
            onInput={(e: Event | React.FormEvent<HTMLElement>) => {
              const val = parseInt((e.target as HTMLInputElement).value, 10);
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
            value={String(arr?.stride ?? 4)}
            onInput={(e: Event | React.FormEvent<HTMLElement>) => {
              const val = parseInt((e.target as HTMLInputElement).value, 10);
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
