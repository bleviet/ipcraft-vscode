import React, { useEffect, useRef, useState } from 'react';
import type { YamlUpdateHandler } from '../../types/editor';
import {
  VSCodeDropdown,
  VSCodeOption,
  VSCodeTextField,
  VSCodeTextArea,
} from '@vscode/webview-ui-toolkit/react';
import { KeyboardShortcutsButton } from '../../shared/components';
import { ACCESS_OPTIONS } from '../../shared/constants';
import RegisterMapVisualizer from '../RegisterMapVisualizer';
import { FIELD_COLORS, FIELD_COLOR_KEYS } from '../../shared/colors';
import { SpatialInsertionService } from '../../services/SpatialInsertionService';
import type { RegisterRuntimeDef } from '../../services/SpatialInsertionService';
import type { RegisterModel } from '../../types/registerModel';
import { toHex } from '../../utils/formatUtils';
import { useAutoFocus } from '../../hooks/useAutoFocus';
import { useEscapeFocus } from '../../hooks/useEscapeFocus';
import { useTableNavigation } from '../../hooks/useTableNavigation';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type RegEditKey = 'name' | 'offset' | 'access' | 'description';
type RegActiveCell = { rowIndex: number; key: RegEditKey };
const REG_COLUMN_ORDER: RegEditKey[] = ['name', 'offset', 'access', 'description'];

function toRuntimeRegisters(registers: RegisterModel[]): RegisterRuntimeDef[] {
  return registers.map((register, index) => {
    const numericOffset =
      typeof register.address_offset === 'number'
        ? register.address_offset
        : typeof register.offset === 'number'
          ? register.offset
          : index * 4;
    return {
      ...register,
      name: String(register.name ?? `reg${index}`),
      address_offset: numericOffset,
      offset: numericOffset,
      access: String(register.access ?? 'read-write'),
      description: String(register.description ?? ''),
    };
  });
}

export interface AddressBlockModel {
  name?: string;
  base_address?: number | string;
  offset?: number | string;
  description?: string;
  usage?: string;
  registers?: RegisterModel[];
  [key: string]: unknown;
}

export interface BlockEditorProps {
  /** The address block object (has name, base_address, registers, etc.). */
  block: AddressBlockModel;
  blockLayout: 'stacked' | 'side-by-side';
  toggleBlockLayout: () => void;
  selectionMeta?: {
    absoluteAddress?: number;
    relativeOffset?: number;
    focusDetails?: boolean;
  };
  onUpdate: YamlUpdateHandler;
  onNavigateToRegister?: (regIndex: number) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Renders and manages editing of a single address block's properties, including:
 * - Block header / description
 * - RegisterMapVisualizer
 * - Keyboard-navigable registers table with insert / delete / reorder support
 */
export function BlockEditor({
  block,
  blockLayout,
  toggleBlockLayout,
  selectionMeta,
  onUpdate,
  onNavigateToRegister,
}: BlockEditorProps) {
  const registers = block?.registers ?? [];
  const baseAddress = Number(block?.base_address ?? block?.offset ?? 0);

  const [selectedRegIndex, setSelectedRegIndex] = useState<number>(-1);
  const [hoveredRegIndex, setHoveredRegIndex] = useState<number | null>(null);
  const [regActiveCell, setRegActiveCell] = useState<RegActiveCell>({
    rowIndex: -1,
    key: 'name',
  });
  const [insertError, setInsertError] = useState<string | null>(null);

  const focusRef = useRef<HTMLDivElement | null>(null);
  const errorRef = useRef<HTMLDivElement | null>(null);

  const getRegColor = (idx: number) => FIELD_COLOR_KEYS[idx % FIELD_COLOR_KEYS.length];

  useAutoFocus(focusRef, !!selectionMeta?.focusDetails, [block?.name]);

  // Clamp selection when block changes.
  useEffect(() => {
    const regs = block?.registers ?? [];
    if (!Array.isArray(regs) || regs.length === 0) {
      setSelectedRegIndex(-1);
      setRegActiveCell({ rowIndex: -1, key: 'name' });
      return;
    }
    setSelectedRegIndex((prev) => {
      if (prev < 0) {
        return 0;
      }
      if (prev >= regs.length) {
        return regs.length - 1;
      }
      return prev;
    });
    setRegActiveCell((prev) => {
      const rowIndex = prev.rowIndex < 0 ? 0 : Math.min(regs.length - 1, prev.rowIndex);
      const key = REG_COLUMN_ORDER.includes(prev.key) ? prev.key : 'name';
      return { rowIndex, key };
    });
  }, [block?.name, (block?.registers ?? []).length]);

  useEscapeFocus(focusRef);

  const liveRegisters = block?.registers ?? [];

  const tryInsertReg = (after: boolean) => {
    setInsertError(null);
    const runtimeRegisters = toRuntimeRegisters(liveRegisters);
    const result = SpatialInsertionService.insertRegister(
      after ? 'after' : 'before',
      runtimeRegisters,
      selectedRegIndex
    );

    if (result.error) {
      setInsertError(result.error);
      return;
    }

    const newIdx = result.newIndex;
    onUpdate(['registers'], result.items);
    setSelectedRegIndex(newIdx);
    setHoveredRegIndex(newIdx);
    setRegActiveCell({ rowIndex: newIdx, key: 'name' });
    window.setTimeout(() => {
      document.querySelector(`tr[data-row-idx="${newIdx}"]`)?.scrollIntoView({ block: 'center' });
    }, 100);
  };

  useTableNavigation<RegEditKey>({
    activeCell: regActiveCell,
    setActiveCell: (cell) => {
      setRegActiveCell(cell);
      if (cell.rowIndex >= 0 && cell.rowIndex < liveRegisters.length) {
        setSelectedRegIndex(cell.rowIndex);
        setHoveredRegIndex(cell.rowIndex);
      }
    },
    rowCount: liveRegisters.length,
    columnOrder: REG_COLUMN_ORDER,
    containerRef: focusRef as React.RefObject<HTMLElement>,
    onEdit: (rowIndex, key) => {
      if (rowIndex < 0 || rowIndex >= liveRegisters.length) {
        return;
      }
      setSelectedRegIndex(rowIndex);
      setHoveredRegIndex(rowIndex);
      setRegActiveCell({ rowIndex, key });
      window.setTimeout(() => {
        const row = document.querySelector(`tr[data-row-idx="${rowIndex}"]`);
        const editor = row?.querySelector(`[data-edit-key="${key}"]`) as HTMLElement | null;
        editor?.focus?.();
      }, 0);
    },
    onDelete: (rowIndex) => {
      if (rowIndex < 0 || rowIndex >= liveRegisters.length) {
        return;
      }
      const currentKey: RegEditKey = REG_COLUMN_ORDER.includes(regActiveCell.key)
        ? regActiveCell.key
        : 'name';
      const newRegs = liveRegisters.filter((_: RegisterModel, i: number) => i !== rowIndex);
      onUpdate(['registers'], newRegs as unknown[]);
      const nextRow = rowIndex > 0 ? rowIndex - 1 : newRegs.length > 0 ? 0 : -1;
      setSelectedRegIndex(nextRow);
      setHoveredRegIndex(nextRow);
      setRegActiveCell({ rowIndex: nextRow, key: currentKey });
    },
    onMove: (fromIndex, delta) => {
      const next = fromIndex + delta;
      if (
        fromIndex < 0 ||
        fromIndex >= liveRegisters.length ||
        next < 0 ||
        next >= liveRegisters.length
      ) {
        return;
      }
      const newRegs = [...liveRegisters];
      const temp = newRegs[fromIndex];
      newRegs[fromIndex] = newRegs[next];
      newRegs[next] = temp;
      newRegs.forEach((r, i) => {
        r.offset = i * 4;
        r.address_offset = i * 4;
      });
      onUpdate(['registers'], newRegs as unknown[]);
      setSelectedRegIndex(next);
      setHoveredRegIndex(next);
      setRegActiveCell((prev) => ({ rowIndex: next, key: prev.key }));
    },
    onInsertAfter: () => tryInsertReg(true),
    onInsertBefore: () => tryInsertReg(false),
    isActive: true,
  });

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const keyLower = (e.key || '').toLowerCase();
      const isInsertArrayAfter = keyLower === 'a' && e.shiftKey;
      const isInsertArrayBefore = keyLower === 'i' && e.shiftKey;
      if (!isInsertArrayAfter && !isInsertArrayBefore) {
        return;
      }
      if (e.ctrlKey || e.metaKey) {
        return;
      }

      const activeEl = document.activeElement as HTMLElement | null;
      const isInRegsArea =
        !!focusRef.current &&
        !!activeEl &&
        (activeEl === focusRef.current || focusRef.current.contains(activeEl));
      if (!isInRegsArea) {
        return;
      }

      const target = e.target as HTMLElement | null;
      const isTypingTarget = !!target?.closest(
        'input, textarea, select, [contenteditable="true"], vscode-text-field, vscode-text-area, vscode-dropdown'
      );
      if (isTypingTarget) {
        return;
      }

      e.preventDefault();
      e.stopPropagation();

      let maxN = 0;
      for (const r of liveRegisters) {
        const match = r.name?.match(/^ARRAY_(\d+)$/i);
        if (match) {
          maxN = Math.max(maxN, parseInt(match[1], 10));
        }
      }
      const arrayName = `ARRAY_${maxN + 1}`;
      const selIdx = selectedRegIndex >= 0 ? selectedRegIndex : liveRegisters.length - 1;
      const selected = liveRegisters[selIdx];
      const selectedOffset = selected?.address_offset ?? selected?.offset ?? 0;
      let selectedSize = 4;
      if (selected?.__kind === 'array') {
        selectedSize = (selected.count ?? 1) * (selected.stride ?? 4);
      }
      const newArraySize = 8;
      const baseOffset = isInsertArrayAfter
        ? Number(selectedOffset) + Number(selectedSize)
        : selectedOffset;
      const newArray = {
        __kind: 'array',
        name: arrayName,
        address_offset: baseOffset,
        offset: baseOffset,
        count: 2,
        stride: 4,
        description: '',
        registers: [
          {
            name: 'reg0',
            offset: 0,
            address_offset: 0,
            access: 'read-write',
            description: '',
            fields: [{ name: 'data', bits: '[31:0]', access: 'read-write', description: '' }],
          },
        ],
      };
      let newRegs: RegisterModel[];
      let newIdx: number;
      if (isInsertArrayAfter) {
        newRegs = [
          ...liveRegisters.slice(0, selIdx + 1),
          newArray,
          ...liveRegisters.slice(selIdx + 1),
        ];
        newIdx = selIdx + 1;
      } else {
        newRegs = [
          ...liveRegisters.slice(0, selIdx),
          newArray,
          ...liveRegisters.slice(selIdx).map((r: RegisterModel) => ({
            ...r,
            offset: Number(r.offset ?? r.address_offset ?? 0) + newArraySize,
            address_offset: Number(r.address_offset ?? r.offset ?? 0) + newArraySize,
          })),
        ];
        newIdx = selIdx;
      }
      onUpdate(['registers'], newRegs as unknown[]);
      setSelectedRegIndex(newIdx);
      setHoveredRegIndex(newIdx);
      setRegActiveCell({ rowIndex: newIdx, key: 'name' });
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [liveRegisters, onUpdate, selectedRegIndex]);

  const visualizer = (
    <RegisterMapVisualizer
      registers={registers}
      hoveredRegIndex={hoveredRegIndex}
      setHoveredRegIndex={setHoveredRegIndex}
      baseAddress={baseAddress}
      onReorderRegisters={(newRegs) => onUpdate(['registers'], newRegs as unknown[])}
      onRegisterClick={onNavigateToRegister}
      layout={blockLayout === 'side-by-side' ? 'vertical' : 'horizontal'}
    />
  );

  const registersTable = (
    <div
      ref={focusRef}
      tabIndex={0}
      data-regs-table="true"
      className="flex-1 overflow-auto min-h-0 outline-none focus:outline-none"
    >
      {insertError ? (
        <div ref={errorRef} className="vscode-error px-4 py-2 text-xs">
          {insertError}
        </div>
      ) : null}
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
          {registers.map((reg: RegisterModel, idx: number) => {
            const color = getRegColor(idx);
            const offset = reg.address_offset ?? reg.offset ?? idx * 4;

            return (
              <tr
                key={`${String(reg.name ?? `reg-${idx}`)}-${String(reg.address_offset ?? reg.offset ?? idx * 4)}`}
                data-row-idx={idx}
                data-reg-idx={idx}
                className={`group vscode-row-solid transition-colors border-l-4 border-transparent h-12 ${
                  idx === selectedRegIndex
                    ? 'vscode-focus-border vscode-row-selected'
                    : idx === hoveredRegIndex
                      ? 'vscode-focus-border vscode-row-hover'
                      : ''
                }`}
                onMouseEnter={() => setHoveredRegIndex(idx)}
                onMouseLeave={() => setHoveredRegIndex(null)}
                onClick={() => {
                  setSelectedRegIndex(idx);
                  setHoveredRegIndex(idx);
                  setRegActiveCell((prev) => ({ rowIndex: idx, key: prev.key }));
                }}
              >
                {/* NAME */}
                <td
                  data-col-key="name"
                  className={`px-6 py-2 font-medium align-middle ${
                    regActiveCell.rowIndex === idx && regActiveCell.key === 'name'
                      ? 'vscode-cell-active'
                      : ''
                  }`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedRegIndex(idx);
                    setHoveredRegIndex(idx);
                    setRegActiveCell({ rowIndex: idx, key: 'name' });
                  }}
                >
                  <div className="flex items-center gap-2">
                    <div
                      className="w-2.5 h-2.5 rounded-sm"
                      style={{ backgroundColor: FIELD_COLORS[color] || color }}
                    />
                    <VSCodeTextField
                      data-edit-key="name"
                      className="flex-1"
                      value={reg.name ?? ''}
                      onBlur={(e: Event | React.FormEvent<HTMLElement>) =>
                        onUpdate(['registers', idx, 'name'], (e.target as HTMLInputElement).value)
                      }
                    />
                  </div>
                </td>
                {/* OFFSET */}
                <td
                  data-col-key="offset"
                  className={`px-4 py-2 font-mono vscode-muted align-middle ${
                    regActiveCell.rowIndex === idx && regActiveCell.key === 'offset'
                      ? 'vscode-cell-active'
                      : ''
                  }`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedRegIndex(idx);
                    setHoveredRegIndex(idx);
                    setRegActiveCell({ rowIndex: idx, key: 'offset' });
                  }}
                >
                  <VSCodeTextField
                    data-edit-key="offset"
                    className="w-full font-mono"
                    value={toHex(offset as number)}
                    onInput={(e: Event | React.FormEvent<HTMLElement>) => {
                      const val = Number((e.target as HTMLInputElement).value);
                      if (!Number.isNaN(val)) {
                        onUpdate(['registers', idx, 'offset'], val);
                      }
                    }}
                  />
                </td>
                {/* ACCESS */}
                <td
                  data-col-key="access"
                  className={`px-4 py-2 align-middle ${
                    regActiveCell.rowIndex === idx && regActiveCell.key === 'access'
                      ? 'vscode-cell-active'
                      : ''
                  }`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedRegIndex(idx);
                    setHoveredRegIndex(idx);
                    setRegActiveCell({ rowIndex: idx, key: 'access' });
                  }}
                >
                  <VSCodeDropdown
                    data-edit-key="access"
                    className="w-full"
                    value={reg.access ?? 'read-write'}
                    onInput={(e: Event | React.FormEvent<HTMLElement>) =>
                      onUpdate(['registers', idx, 'access'], (e.target as HTMLInputElement).value)
                    }
                  >
                    {ACCESS_OPTIONS.map((opt) => (
                      <VSCodeOption key={opt} value={opt}>
                        {opt}
                      </VSCodeOption>
                    ))}
                  </VSCodeDropdown>
                </td>
                {/* DESCRIPTION */}
                <td
                  data-col-key="description"
                  className={`px-6 py-2 vscode-muted align-middle ${
                    regActiveCell.rowIndex === idx && regActiveCell.key === 'description'
                      ? 'vscode-cell-active'
                      : ''
                  }`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedRegIndex(idx);
                    setHoveredRegIndex(idx);
                    setRegActiveCell({ rowIndex: idx, key: 'description' });
                  }}
                >
                  <VSCodeTextArea
                    data-edit-key="description"
                    className="w-full"
                    rows={1}
                    value={reg.description ?? ''}
                    onInput={(e: Event | React.FormEvent<HTMLElement>) =>
                      onUpdate(
                        ['registers', idx, 'description'],
                        (e.target as HTMLTextAreaElement).value
                      )
                    }
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="flex flex-col w-full h-full min-h-0">
      <div className="vscode-surface border-b vscode-border px-6 py-2 shrink-0">
        <div className="flex justify-between items-start gap-4">
          <div>
            <h2 className="text-xl font-bold font-mono tracking-tight">
              {block?.name ?? 'Address Block'}
            </h2>
            <p className="vscode-muted text-xs mt-0.5 max-w-2xl">
              {block?.description ?? `Base: ${toHex(baseAddress)}`} • {block?.usage ?? 'register'}
            </p>
          </div>
          <button
            className="p-2 rounded-md transition-colors vscode-icon-button"
            onClick={toggleBlockLayout}
            title={
              blockLayout === 'stacked'
                ? 'Switch to side-by-side layout'
                : 'Switch to stacked layout'
            }
            aria-label="Toggle block layout"
            type="button"
          >
            <span
              className={`codicon ${
                blockLayout === 'stacked' ? 'codicon-split-horizontal' : 'codicon-split-vertical'
              }`}
            />
          </button>
        </div>
      </div>

      {blockLayout === 'side-by-side' ? (
        <div className="flex-1 flex overflow-hidden min-h-0">
          <div className="register-visualizer-pane shrink-0 overflow-y-auto border-r vscode-border">
            {visualizer}
          </div>
          <div className="flex-1 vscode-surface min-h-0 flex flex-col overflow-hidden">
            {registersTable}
          </div>
        </div>
      ) : (
        <>
          <div className="vscode-surface border-b vscode-border p-8 flex flex-col gap-6 shrink-0 relative overflow-hidden">
            <div className="w-full relative z-10 mt-2 select-none">{visualizer}</div>
          </div>
          <div className="flex-1 flex overflow-hidden min-h-0">
            <div className="flex-1 vscode-surface min-h-0 flex flex-col">{registersTable}</div>
          </div>
        </>
      )}
      <KeyboardShortcutsButton context="block" />
    </div>
  );
}
