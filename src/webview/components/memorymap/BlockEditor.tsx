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
  const baseAddress = Number(
    block?.base_address ??
      (block as Record<string, unknown> | undefined)?.baseAddress ??
      block?.offset ??
      0
  );

  const [selectedRegIndex, setSelectedRegIndex] = useState<number>(-1);
  const [hoveredRegIndex, setHoveredRegIndex] = useState<number | null>(null);
  const [regActiveCell, setRegActiveCell] = useState<RegActiveCell>({
    rowIndex: -1,
    key: 'name',
  });
  const [insertError, setInsertError] = useState<string | null>(null);
  const [insertHoverGap, setInsertHoverGap] = useState<number | null>(null);
  const [insertBarScrollY, setInsertBarScrollY] = useState<number | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    regIndex: number;
  } | null>(null);

  const focusRef = useRef<HTMLDivElement | null>(null);
  const errorRef = useRef<HTMLDivElement | null>(null);
  const tbodyRef = useRef<HTMLTableSectionElement | null>(null);
  const contextMenuRef = useRef<HTMLDivElement | null>(null);
  const insertClearRef = useRef<number | null>(null);

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
    const newRegs = [...liveRegisters];
    const newIdx = after ? selectedRegIndex + 1 : Math.max(0, selectedRegIndex);

    let maxN = 0;
    for (const r of liveRegisters) {
      const match = String(r.name ?? '').match(/^reg(\d+)$/i);
      if (match) {
        maxN = Math.max(maxN, parseInt(match[1], 10));
      }
    }
    const name = `reg${maxN + 1}`;

    newRegs.splice(newIdx, 0, {
      name,
      access: 'read-write',
      description: '',
      offset: 0,
      address_offset: 0,
    });

    onUpdate(['registers'], newRegs as unknown[]);
    setSelectedRegIndex(newIdx);
    setHoveredRegIndex(newIdx);
    setRegActiveCell({ rowIndex: newIdx, key: 'name' });
    window.setTimeout(() => {
      document.querySelector(`tr[data-row-idx="${newIdx}"]`)?.scrollIntoView({ block: 'center' });
    }, 100);
  };

  const scheduleInsertClear = () => {
    if (insertClearRef.current) {
      clearTimeout(insertClearRef.current);
    }
    insertClearRef.current = window.setTimeout(() => {
      setInsertHoverGap(null);
      setInsertBarScrollY(null);
    }, 150);
  };

  const cancelInsertClear = () => {
    if (insertClearRef.current) {
      clearTimeout(insertClearRef.current);
      insertClearRef.current = null;
    }
  };

  const insertAtGap = (gapIndex: number) => {
    setInsertError(null);
    const newRegs = [...liveRegisters];
    const newIdx = gapIndex;

    let maxN = 0;
    for (const r of liveRegisters) {
      const match = String(r.name ?? '').match(/^reg(\d+)$/i);
      if (match) {
        maxN = Math.max(maxN, parseInt(match[1], 10));
      }
    }
    const name = `reg${maxN + 1}`;

    newRegs.splice(newIdx, 0, {
      name,
      access: 'read-write',
      description: '',
      offset: 0,
      address_offset: 0,
    });

    onUpdate(['registers'], newRegs as unknown[]);
    setSelectedRegIndex(newIdx);
    setHoveredRegIndex(newIdx);
    setRegActiveCell({ rowIndex: newIdx, key: 'name' });
    setInsertHoverGap(null);
    setInsertBarScrollY(null);
    window.setTimeout(() => {
      document.querySelector(`tr[data-row-idx="${newIdx}"]`)?.scrollIntoView({ block: 'center' });
    }, 100);
  };

  const deleteReg = (idx: number) => {
    if (idx < 0 || idx >= liveRegisters.length) {
      return;
    }
    const newRegs = liveRegisters.filter((_: RegisterModel, i: number) => i !== idx);
    onUpdate(['registers'], newRegs as unknown[]);
    const nextRow = idx > 0 ? idx - 1 : newRegs.length > 0 ? 0 : -1;
    setSelectedRegIndex(nextRow);
    setHoveredRegIndex(nextRow);
    setRegActiveCell({ rowIndex: nextRow, key: 'name' });
  };

  const closeContextMenu = () => setContextMenu(null);

  const handleTbodyMouseMove = (e: React.MouseEvent<HTMLTableSectionElement>) => {
    cancelInsertClear();
    const rows = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('tr[data-row-idx]'));
    if (rows.length === 0) {
      return;
    }
    const THRESHOLD = 12;
    const mouseY = e.clientY;
    for (let i = 0; i <= rows.length; i++) {
      const gapViewportY =
        i === 0 ? rows[0].getBoundingClientRect().top : rows[i - 1].getBoundingClientRect().bottom;
      if (Math.abs(mouseY - gapViewportY) < THRESHOLD) {
        const containerEl = focusRef.current;
        if (containerEl) {
          const cRect = containerEl.getBoundingClientRect();
          setInsertHoverGap(i);
          setInsertBarScrollY(gapViewportY - cRect.top + containerEl.scrollTop);
        }
        return;
      }
    }
    scheduleInsertClear();
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

      // Global layout engine will recalculate correct offsets after we save
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
        newRegs = [...liveRegisters.slice(0, selIdx), newArray, ...liveRegisters.slice(selIdx)];
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

  useEffect(() => {
    if (!contextMenu) {
      return;
    }
    const handlePointerDown = (e: PointerEvent) => {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) {
        setContextMenu(null);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setContextMenu(null);
      }
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [contextMenu]);

  const visualizer = (
    <RegisterMapVisualizer
      registers={registers}
      hoveredRegIndex={hoveredRegIndex}
      setHoveredRegIndex={setHoveredRegIndex}
      baseAddress={baseAddress}
      onReorderRegisters={(newRegs) => onUpdate(['registers'], newRegs as unknown[])}
      onRegisterClick={onNavigateToRegister}
      onInsertAtGap={insertAtGap}
      onDeleteReg={deleteReg}
      layout={blockLayout === 'side-by-side' ? 'vertical' : 'horizontal'}
    />
  );

  const registersTable = (
    <div
      ref={focusRef}
      tabIndex={0}
      data-regs-table="true"
      className="flex-1 overflow-auto min-h-0 outline-none focus:outline-none relative"
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
        <tbody
          ref={tbodyRef}
          className="text-sm"
          onMouseMove={handleTbodyMouseMove}
          onMouseLeave={scheduleInsertClear}
        >
          {registers.map((reg: RegisterModel, idx: number) => {
            const color = getRegColor(idx);
            const offset = reg.address_offset ?? reg.offset ?? idx * 4;

            return (
              <tr
                key={`${String(reg.name ?? `reg-${idx}`)}-${String(reg.address_offset ?? reg.offset ?? idx * 4)}`}
                data-row-idx={idx}
                data-reg-idx={idx}
                className={`group vscode-row-solid transition-colors border-l-4 border-transparent border-b vscode-border h-12 ${
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
                onContextMenu={(e) => {
                  e.preventDefault();
                  setContextMenu({ x: e.clientX, y: e.clientY, regIndex: idx });
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
      {insertHoverGap !== null && insertBarScrollY !== null && (
        <div
          className="absolute left-0 right-0 z-20 flex items-center px-4 pointer-events-none"
          style={{ top: insertBarScrollY, transform: 'translateY(-50%)' }}
          onMouseEnter={cancelInsertClear}
          onMouseLeave={scheduleInsertClear}
        >
          <div
            className="flex-1 h-[2px] rounded-full"
            style={{ background: 'linear-gradient(to right, #f97316, #f43f5e)' }}
          />
          <button
            className="pointer-events-auto w-5 h-5 rounded-full text-white text-[11px] font-bold flex items-center justify-center hover:scale-110 transition-transform shadow mx-1 flex-shrink-0"
            style={{ background: 'linear-gradient(135deg, #f97316, #f43f5e)' }}
            title={`Insert register at position ${insertHoverGap}`}
            onClick={(e) => {
              e.stopPropagation();
              insertAtGap(insertHoverGap);
            }}
          >
            +
          </button>
          <div
            className="flex-1 h-[2px] rounded-full"
            style={{ background: 'linear-gradient(to left, #f97316, #f43f5e)' }}
          />
        </div>
      )}
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
      {contextMenu && (
        <div
          ref={contextMenuRef}
          className="fixed z-[200] min-w-[160px] rounded-lg shadow-xl border vscode-border vscode-surface overflow-hidden text-sm"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <button
            className="w-full text-left px-4 py-2 flex items-center gap-2 cursor-pointer hover:bg-[var(--vscode-list-hoverBackground)] transition-colors"
            onClick={() => {
              insertAtGap(contextMenu.regIndex);
              closeContextMenu();
            }}
          >
            <span className="codicon codicon-arrow-up text-xs" />
            Insert Above
          </button>
          <button
            className="w-full text-left px-4 py-2 flex items-center gap-2 cursor-pointer hover:bg-[var(--vscode-list-hoverBackground)] transition-colors"
            onClick={() => {
              insertAtGap(contextMenu.regIndex + 1);
              closeContextMenu();
            }}
          >
            <span className="codicon codicon-arrow-down text-xs" />
            Insert Below
          </button>
          <div className="border-t vscode-border my-0.5" />
          <button
            className="w-full text-left px-4 py-2 flex items-center gap-2 cursor-pointer hover:bg-[var(--vscode-list-hoverBackground)] transition-colors"
            style={{ color: 'var(--vscode-errorForeground)' }}
            onClick={() => {
              deleteReg(contextMenu.regIndex);
              closeContextMenu();
            }}
          >
            <span className="codicon codicon-trash text-xs" />
            Delete
          </button>
        </div>
      )}
    </div>
  );
}
