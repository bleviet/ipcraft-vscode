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
import { useTableNavigation } from '../../hooks/useTableNavigation';
import { useCellEditGuard } from '../../hooks/useCellEditGuard';
import { RegisterTableRow, REG_COLUMN_ORDER } from './RegisterTableRow';
import type { RegEditKey, RegActiveCell } from './RegisterTableRow';

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

  const [selectedRegIndex, setSelectedRegIndex] = useState<number>(-1);
  const [hoveredRegIndex, setHoveredRegIndex] = useState<number | null>(null);
  const [regActiveCell, setRegActiveCell] = useState<RegActiveCell>({
    rowIndex: -1,
    key: 'name',
  });
  const tableRef = useRef<HTMLDivElement | null>(null);

  const { cancelEditRef, captureEditSnapshot } = useCellEditGuard({
    rows: nestedRegisters,
    rowsPath: ['registers'],
    onUpdate,
    containerRef: tableRef as React.RefObject<HTMLElement>,
  });

  const getRegColor = (i: number) => FIELD_COLOR_KEYS[i % FIELD_COLOR_KEYS.length];

  const scrollToCell = (rowIndex: number, key: string) => {
    window.setTimeout(() => {
      const row = document.querySelector(`tr[data-reg-idx="${rowIndex}"]`);
      row?.scrollIntoView({ block: 'nearest' });
      const cell = row?.querySelector(`td[data-col-key="${key}"]`);
      cell?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }, 0);
  };

  const insertNestedReg = (after: boolean) => {
    let maxN = 0;
    for (const r of nestedRegisters) {
      const match = r.name?.match(/^reg(\d+)$/i);
      if (match) {
        maxN = Math.max(maxN, parseInt(match[1], 10));
      }
    }
    const newName = `reg${maxN + 1}`;
    const selIdx = selectedRegIndex >= 0 ? selectedRegIndex : nestedRegisters.length - 1;
    const selected = nestedRegisters[selIdx];
    const selectedOffset = selected?.address_offset ?? selected?.offset ?? 0;
    const newOffset = after ? Number(selectedOffset) + 4 : Math.max(0, Number(selectedOffset) - 4);

    const newReg = {
      name: newName,
      offset: newOffset,
      address_offset: newOffset,
      access: 'read-write',
      description: '',
      fields: [{ name: 'data', bits: '[31:0]', access: 'read-write', description: '' }],
    };

    let newRegs: RegisterModel[];
    let newIdx: number;
    if (after) {
      newRegs = [
        ...nestedRegisters.slice(0, selIdx + 1),
        newReg,
        ...nestedRegisters.slice(selIdx + 1),
      ];
      newIdx = selIdx + 1;
    } else {
      newRegs = [...nestedRegisters.slice(0, selIdx), newReg, ...nestedRegisters.slice(selIdx)];
      newIdx = selIdx;
    }

    onUpdate(['registers'], newRegs as unknown[]);
    setSelectedRegIndex(newIdx);
    setHoveredRegIndex(newIdx);
    setRegActiveCell({ rowIndex: newIdx, key: 'name' });
    scrollToCell(newIdx, 'name');
  };

  useTableNavigation<RegEditKey>({
    activeCell: regActiveCell,
    setActiveCell: (cell) => {
      setRegActiveCell(cell);
      if (cell.rowIndex >= 0 && cell.rowIndex < nestedRegisters.length) {
        setSelectedRegIndex(cell.rowIndex);
        setHoveredRegIndex(cell.rowIndex);
      }
    },
    rowCount: nestedRegisters.length,
    columnOrder: REG_COLUMN_ORDER,
    containerRef: tableRef as React.RefObject<HTMLElement>,
    onEdit: (rowIndex, key) => {
      if (rowIndex < 0 || rowIndex >= nestedRegisters.length) {
        return;
      }
      setSelectedRegIndex(rowIndex);
      setHoveredRegIndex(rowIndex);
      setRegActiveCell({ rowIndex, key });
      window.setTimeout(() => {
        const row = document.querySelector(`tr[data-reg-idx="${rowIndex}"]`);
        const editor = row?.querySelector(`[data-edit-key="${key}"]`) as HTMLElement | null;
        editor?.focus?.();
      }, 0);
    },
    onDelete: (rowIndex) => {
      if (rowIndex < 0 || rowIndex >= nestedRegisters.length) {
        return;
      }
      const newRegs = nestedRegisters.filter((_: RegisterModel, i: number) => i !== rowIndex);
      onUpdate(['registers'], newRegs as unknown[]);
      const nextRow = rowIndex > 0 ? rowIndex - 1 : newRegs.length > 0 ? 0 : -1;
      setSelectedRegIndex(nextRow);
      setHoveredRegIndex(nextRow);
      setRegActiveCell((prev) => ({ rowIndex: nextRow, key: prev.key }));
    },
    onInsertAfter: () => insertNestedReg(true),
    onInsertBefore: () => insertNestedReg(false),
    isActive: true,
    rowSelectorAttr: 'data-reg-idx',
  });

  useEffect(() => {
    if (!Array.isArray(nestedRegisters) || nestedRegisters.length === 0) {
      setSelectedRegIndex(-1);
      setRegActiveCell({ rowIndex: -1, key: 'name' });
      return;
    }
    setSelectedRegIndex((prev) => {
      if (prev < 0) {
        return 0;
      }
      if (prev >= nestedRegisters.length) {
        return nestedRegisters.length - 1;
      }
      return prev;
    });
    setRegActiveCell((prev) => {
      const rowIndex = prev.rowIndex < 0 ? 0 : Math.min(nestedRegisters.length - 1, prev.rowIndex);
      const key = REG_COLUMN_ORDER.includes(prev.key) ? prev.key : 'name';
      return { rowIndex, key };
    });
  }, [arr?.name, nestedRegisters.length]);

  const visualizer = (
    <RegisterMapVisualizer
      registers={nestedRegisters}
      hoveredRegIndex={hoveredRegIndex}
      setHoveredRegIndex={setHoveredRegIndex}
      baseAddress={0}
      onReorderRegisters={(newRegs) => onUpdate(['registers'], newRegs)}
      onRegisterClick={(idx) => {
        setSelectedRegIndex(idx);
        setHoveredRegIndex(idx);
      }}
      layout={arrayLayout === 'side-by-side' ? 'vertical' : 'horizontal'}
    />
  );

  const registersTable = (
    <div
      ref={tableRef}
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
        <tbody className="divide-y vscode-border text-sm">
          {nestedRegisters.map((reg: RegisterModel, idx: number) => (
            <RegisterTableRow
              key={`${String(reg.name ?? `reg-${idx}`)}-${String(reg.address_offset ?? reg.offset ?? idx * 4)}`}
              reg={reg}
              idx={idx}
              isSelected={selectedRegIndex === idx}
              isHovered={hoveredRegIndex === idx}
              regActiveCell={regActiveCell}
              color={getRegColor(idx)}
              cancelEditRef={cancelEditRef}
              captureEditSnapshot={captureEditSnapshot}
              onUpdate={onUpdate}
              onRowClick={() => {
                setSelectedRegIndex(idx);
                setHoveredRegIndex(idx);
                setRegActiveCell((prev) => ({ rowIndex: idx, key: prev.key }));
              }}
              onCellClick={(key) => {
                setSelectedRegIndex(idx);
                setHoveredRegIndex(idx);
                setRegActiveCell({ rowIndex: idx, key });
              }}
              onMouseEnter={() => setHoveredRegIndex(idx)}
              onMouseLeave={() => setHoveredRegIndex(null)}
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
