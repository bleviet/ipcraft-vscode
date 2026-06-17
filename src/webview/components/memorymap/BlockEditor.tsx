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
import { generateUniqueName } from '../../utils/naming';
import { useAutoFocus } from '../../hooks/useAutoFocus';
import { useTableEditorState } from '../../hooks/useTableEditorState';
import { RegisterTableRow, REG_COLUMN_ORDER } from './RegisterTableRow';
import type { RegEditKey } from './RegisterTableRow';
import { reconcileRowIds, type TableRowWrapper } from '../../utils/rowIdentity';

export interface AddressBlockModel {
  name?: string;
  base_address?: number | string;
  offset?: number | string;
  description?: string;
  usage?: string;
  registers?: RegisterModel[];
  [key: string]: unknown;
}

interface DragState {
  active: boolean;
  fromRowId: string | null;
  toRowId: string | null;
}

const DRAG_IDLE: DragState = { active: false, fromRowId: null, toRowId: null };

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

  const [insertError, setInsertError] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    regId: string;
  } | null>(null);

  const tbodyRef = useRef<HTMLTableSectionElement | null>(null);

  const liveRegisters = block?.registers ?? [];

  // ---- wrapped rows for row identity ----
  const [wrappedRegisters, setWrappedRegisters] = useState<Array<TableRowWrapper<RegisterModel>>>(
    []
  );

  useEffect(() => {
    setWrappedRegisters((prev) => reconcileRowIds(prev, liveRegisters));
  }, [liveRegisters]);

  const insertNewReg = (newIdx: number, autoFocus = false) => {
    setInsertError(null);
    const newRegs = [...liveRegisters];
    const name = generateUniqueName(liveRegisters, 'reg');
    newRegs.splice(newIdx, 0, {
      name,
      description: '',
      offset: 0,
      address_offset: 0,
    });
    if (autoFocus) {
      pendingInsertFocusRef.current = { name, key: 'name' };
    } else {
      pendingSelectRef.current = { name, key: 'name' };
    }
    onUpdate(['registers'], newRegs as unknown[]);
  };

  const deleteReg = (rowId: string) => {
    const idx = wrappedRegisters.findIndex((w) => w.rowId === rowId);
    if (idx < 0 || idx >= liveRegisters.length) {
      return;
    }
    const newRegs = liveRegisters.filter((_: RegisterModel, i: number) => i !== idx);
    onUpdate(['registers'], newRegs as unknown[]);
    const nextRow = idx > 0 ? idx - 1 : newRegs.length > 0 ? 0 : -1;
    window.setTimeout(() => {
      editor.selectRow(nextRow, editor.activeCell.key);
    }, 0);
  };

  const editor = useTableEditorState<RegisterModel, RegEditKey>({
    rows: wrappedRegisters,
    rowsPath: ['registers'],
    columnOrder: REG_COLUMN_ORDER,
    onUpdate,
    onInsertAfter: () => {
      const newIdx = editor.selectedIndex + 1;
      insertNewReg(newIdx);
    },
    onInsertBefore: () => {
      const newIdx = Math.max(0, editor.selectedIndex);
      insertNewReg(newIdx);
    },
    onDelete: deleteReg,
    onMove: (rowId, delta) => {
      const fromIndex = wrappedRegisters.findIndex((w) => w.rowId === rowId);
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
      onUpdate(['registers'], newRegs as unknown[]);
    },
    enableHoverInsert: true,
    clampDeps: [block?.name],
  });

  const pendingInsertFocusRef = useRef<{ name: string; key: RegEditKey } | null>(null);
  const pendingSelectRef = useRef<{ name: string; key: RegEditKey } | null>(null);

  useEffect(() => {
    if (pendingInsertFocusRef.current) {
      const { name, key } = pendingInsertFocusRef.current;
      const index = wrappedRegisters.findIndex((w) => w.model.name === name);
      if (index >= 0) {
        const rowId = wrappedRegisters[index].rowId;
        editor.selectRow(index, key);
        editor.focusCellEditor(rowId, key);
        document.querySelector(`tr[data-row-id="${rowId}"]`)?.scrollIntoView({ block: 'center' });
        pendingInsertFocusRef.current = null;
      }
    }
    if (pendingSelectRef.current) {
      const { name, key } = pendingSelectRef.current;
      const index = wrappedRegisters.findIndex((w) => w.model.name === name);
      if (index >= 0) {
        const rowId = wrappedRegisters[index].rowId;
        editor.selectRow(index, key);
        document.querySelector(`tr[data-row-id="${rowId}"]`)?.scrollIntoView({ block: 'center' });
        pendingSelectRef.current = null;
      }
    }
  }, [wrappedRegisters, editor]);

  const getRegColor = (idx: number) => FIELD_COLOR_KEYS[idx % FIELD_COLOR_KEYS.length];

  useAutoFocus(
    editor.containerRef as React.RefObject<HTMLDivElement>,
    !!selectionMeta?.focusDetails,
    [block?.name]
  );

  const insertAtGap = (gapIndex: number) => {
    insertNewReg(gapIndex, true);
    editor.clearInsertBar();
  };

  const closeContextMenu = () => setContextMenu(null);

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
          const newRegs = [...liveRegisters];
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
  }, [dragState, wrappedRegisters, liveRegisters, onUpdate]);

  // Shift+A / Shift+I: insert register array
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
      const container = editor.containerRef.current;
      const isInRegsArea =
        !!container && !!activeEl && (activeEl === container || container.contains(activeEl));
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

      const arrayName = generateUniqueName(liveRegisters, 'ARRAY_');
      const selIdx = editor.selectedIndex >= 0 ? editor.selectedIndex : liveRegisters.length - 1;
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
            description: '',
            fields: [{ name: 'data', bits: '[31:0]', access: 'read-write', description: '' }],
          },
        ],
      };
      let newRegs: RegisterModel[];
      if (isInsertArrayAfter) {
        newRegs = [
          ...liveRegisters.slice(0, selIdx + 1),
          newArray,
          ...liveRegisters.slice(selIdx + 1),
        ];
      } else {
        newRegs = [...liveRegisters.slice(0, selIdx), newArray, ...liveRegisters.slice(selIdx)];
      }
      pendingSelectRef.current = { name: arrayName, key: 'name' };
      onUpdate(['registers'], newRegs as unknown[]);
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [liveRegisters, onUpdate, editor]);

  const visualizer = (
    <RegisterMapVisualizer
      registers={registers}
      hoveredRegIndex={editor.hoveredIndex}
      setHoveredRegIndex={editor.setHoveredFieldIndex}
      baseAddress={baseAddress}
      onReorderRegisters={(newRegs) => onUpdate(['registers'], newRegs as unknown[])}
      onRegisterClick={onNavigateToRegister}
      onInsertAtGap={insertAtGap}
      onDeleteReg={(idx) => {
        const rowId = wrappedRegisters[idx]?.rowId;
        if (rowId) {
          deleteReg(rowId);
        }
      }}
      layout={blockLayout === 'side-by-side' ? 'vertical' : 'horizontal'}
    />
  );

  const registersTable = (
    <div
      ref={editor.containerRef as React.RefObject<HTMLDivElement>}
      tabIndex={0}
      data-regs-table="true"
      className={`flex-1 overflow-auto min-h-0 outline-none focus:outline-none relative${dragState.active ? ' cursor-grabbing select-none' : ''}`}
    >
      {insertError ? <div className="vscode-error px-4 py-2 text-xs">{insertError}</div> : null}
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
        <tbody ref={tbodyRef} className="text-sm" {...editor.insertBarTbodyProps}>
          {wrappedRegisters.map((wrapped: TableRowWrapper<RegisterModel>, idx: number) => (
            <RegisterTableRow
              key={wrapped.rowId}
              reg={wrapped.model}
              rowId={wrapped.rowId}
              idx={idx}
              isSelected={wrapped.rowId === editor.selectedRowId}
              isHovered={wrapped.rowId === editor.hoveredRowId}
              regActiveCell={editor.activeCell}
              color={getRegColor(idx)}
              cancelEditRef={editor.cancelEditRef}
              captureEditSnapshot={editor.captureEditSnapshot}
              onUpdate={onUpdate}
              onRowClick={() => editor.selectRow(idx)}
              onCellClick={(key) => editor.selectRow(idx, key)}
              onMouseEnter={() => editor.setHoveredRowId(wrapped.rowId)}
              onMouseLeave={() => editor.setHoveredRowId(null)}
              onContextMenu={(e) => {
                e.preventDefault();
                setContextMenu({ x: e.clientX, y: e.clientY, regId: wrapped.rowId });
              }}
              isDragSource={dragState.active && dragState.fromRowId === wrapped.rowId}
              isDragTarget={
                dragState.active &&
                dragState.toRowId === wrapped.rowId &&
                dragState.fromRowId !== wrapped.rowId
              }
              onDragHandlePointerDown={(e) => handleDragHandlePointerDown(wrapped.rowId, e)}
              onPointerEnterRow={() => handleDragEnterRow(wrapped.rowId)}
              siblingNames={liveRegisters
                .filter((_: RegisterModel, i: number) => i !== idx)
                .map((r: RegisterModel) => String(r.name ?? ''))}
              baseAddress={baseAddress}
            />
          ))}
        </tbody>
      </table>
      <HoverInsertBar
        gapIndex={editor.insertHoverGap}
        positionY={editor.insertBarScrollY}
        itemLabel="register"
        onInsert={insertAtGap}
        {...editor.insertBarHoverProps}
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
            onInsertAbove={() => {
              const idx = wrappedRegisters.findIndex((w) => w.rowId === contextMenu!.regId);
              insertAtGap(idx);
            }}
            onInsertBelow={() => {
              const idx = wrappedRegisters.findIndex((w) => w.rowId === contextMenu!.regId);
              insertAtGap(idx + 1);
            }}
            onDelete={() => deleteReg(contextMenu!.regId)}
            onClose={closeContextMenu}
          />
        </>
      }
      layout={blockLayout}
    />
  );
}
