import React, { useEffect, useRef, useState } from 'react';
import type { YamlUpdateHandler } from '../../types/editor';
import {
  KeyboardShortcutsButton,
  EditorHeader,
  TwoPanelEditorLayout,
  HoverInsertBar,
  TableContextMenu,
} from '../../shared/components';
import RegisterMapVisualizer from '../RegisterMapVisualizer';
import { FIELD_COLOR_KEYS } from '../../shared/colors';
import type { RegisterModel } from '../../types/registerModel';
import { toHex } from '../../utils/formatUtils';
import { useAutoFocus } from '../../hooks/useAutoFocus';
import { useTableNavigation } from '../../hooks/useTableNavigation';
import { useCellEditGuard } from '../../hooks/useCellEditGuard';
import { useHoverInsertBar } from '../../hooks/useHoverInsertBar';
import { RegisterTableRow, REG_COLUMN_ORDER } from './RegisterTableRow';
import type { RegEditKey, RegActiveCell } from './RegisterTableRow';

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
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    regIndex: number;
  } | null>(null);

  const focusRef = useRef<HTMLDivElement | null>(null);
  const tbodyRef = useRef<HTMLTableSectionElement | null>(null);

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

  const liveRegisters = block?.registers ?? [];

  const { cancelEditRef, captureEditSnapshot } = useCellEditGuard({
    rows: liveRegisters,
    rowsPath: ['registers'],
    onUpdate,
    containerRef: focusRef as React.RefObject<HTMLElement>,
  });

  const {
    insertHoverGap,
    insertBarScrollY,
    tbodyProps: insertBarTbodyProps,
    barProps: insertBarHoverProps,
    clear: clearInsertBar,
  } = useHoverInsertBar(focusRef as React.RefObject<HTMLElement>);

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
    clearInsertBar();
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
      {insertError ? <div className="vscode-error px-4 py-2 text-xs">{insertError}</div> : null}
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
        <tbody ref={tbodyRef} className="text-sm" {...insertBarTbodyProps}>
          {registers.map((reg: RegisterModel, idx: number) => (
            <RegisterTableRow
              key={`${String(reg.name ?? `reg-${idx}`)}-${String(reg.address_offset ?? reg.offset ?? idx * 4)}`}
              reg={reg}
              idx={idx}
              isSelected={idx === selectedRegIndex}
              isHovered={idx === hoveredRegIndex}
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
              onContextMenu={(e) => {
                e.preventDefault();
                setContextMenu({ x: e.clientX, y: e.clientY, regIndex: idx });
              }}
            />
          ))}
        </tbody>
      </table>
      <HoverInsertBar
        gapIndex={insertHoverGap}
        positionY={insertBarScrollY}
        itemLabel="register"
        onInsert={insertAtGap}
        {...insertBarHoverProps}
      />
    </div>
  );

  return (
    <TwoPanelEditorLayout
      header={
        <EditorHeader
          title={block?.name ?? 'Address Block'}
          description={`${block?.description ?? `Base: ${toHex(baseAddress)}`} • ${block?.usage ?? 'register'}`}
          layout={blockLayout}
          onToggleLayout={toggleBlockLayout}
        />
      }
      visualizer={visualizer}
      table={registersTable}
      footer={
        <>
          <KeyboardShortcutsButton context="block" />
          <TableContextMenu
            position={contextMenu ? { x: contextMenu.x, y: contextMenu.y } : null}
            onInsertAbove={() => insertAtGap(contextMenu!.regIndex)}
            onInsertBelow={() => insertAtGap(contextMenu!.regIndex + 1)}
            onDelete={() => deleteReg(contextMenu!.regIndex)}
            onClose={closeContextMenu}
          />
        </>
      }
      layout={blockLayout}
    />
  );
}
