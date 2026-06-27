import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { YamlUpdateHandler, BitFieldRecord } from '../../types/editor';
import {
  KeyboardShortcutsButton,
  EditorHeader,
  TwoPanelEditorLayout,
  RegisterActionsMenu,
} from '../../shared/components';
import RegisterMapVisualizer from '../RegisterMapVisualizer';
import type { RegisterModel } from '../../types/registerModel';
import type { RegisterDef } from '../../types/memoryMap';
import { toHex } from '../../utils/formatUtils';
import { generateUniqueName } from '../../utils/naming';
import { useAutoFocus } from '../../hooks/useAutoFocus';
import { useTableEditorState } from '../../hooks/useTableEditorState';
import { REG_COLUMN_ORDER, type RegEditKey } from './RegisterTableRow';
import { reconcileRowIds, type TableRowWrapper } from '../../utils/rowIdentity';
import { RegisterEditor } from '../register/RegisterEditor';

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

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Master-detail editor for a single address block:
 * - Left rail: editable register cards (RegisterMapVisualizer), the master list.
 * - Right detail: the selected register's BitFieldVisualizer + FieldsTable
 *   (an embedded RegisterEditor). Register arrays route to their own editor.
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
  const baseAddress = Number(
    block?.base_address ??
      (block as Record<string, unknown> | undefined)?.baseAddress ??
      block?.offset ??
      0
  );

  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    regId: string;
  } | null>(null);

  const liveRegisters = block?.registers ?? [];

  // ---- wrapped rows for row identity ----
  const [wrappedRegisters, setWrappedRegisters] = useState<Array<TableRowWrapper<RegisterModel>>>(
    []
  );

  useEffect(() => {
    setWrappedRegisters((prev) => reconcileRowIds(prev, liveRegisters));
  }, [liveRegisters]);

  const pendingSelectRef = useRef<{ name: string } | null>(null);

  const insertNewItem = (
    newIdx: number,
    kind: 'register' | 'flat-array' | 'array' = 'register'
  ) => {
    const newRegs = [...liveRegisters];

    if (kind === 'array') {
      const arrayName = generateUniqueName(liveRegisters, 'array');
      newRegs.splice(newIdx, 0, {
        __kind: 'array',
        name: arrayName,
        offset: 0,
        address_offset: 0,
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
      });
      pendingSelectRef.current = { name: arrayName };
    } else if (kind === 'flat-array') {
      const name = generateUniqueName(liveRegisters, 'regArray');
      newRegs.splice(newIdx, 0, {
        name,
        offset: 0,
        address_offset: 0,
        count: 2,
        stride: 4,
        description: '',
      });
      pendingSelectRef.current = { name };
    } else {
      const name = generateUniqueName(liveRegisters, 'reg');
      newRegs.splice(newIdx, 0, {
        name,
        description: '',
        offset: 0,
        address_offset: 0,
        fields: [{ name: 'data', bits: '[31:0]', access: 'read-write', description: '' }],
      });
      pendingSelectRef.current = { name };
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
    const nextRow = idx < newRegs.length ? idx : newRegs.length - 1;
    window.setTimeout(() => {
      editor.selectRow(nextRow, editor.activeCell.key);
    }, 0);
  };

  const editor = useTableEditorState<RegisterModel, RegEditKey>({
    rows: wrappedRegisters,
    rowsPath: ['registers'],
    columnOrder: REG_COLUMN_ORDER,
    onUpdate,
    rowSelectorAttr: 'data-viz-row',
    onInsertAfter: () => {
      const newIdx = editor.selectedIndex + 1;
      insertNewItem(newIdx, 'register');
    },
    onInsertBefore: () => {
      const newIdx = Math.max(0, editor.selectedIndex);
      insertNewItem(newIdx, 'register');
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
    enableHoverInsert: false,
    clampDeps: [block?.name],
  });

  // ---- Select a freshly inserted register once it appears ----
  useEffect(() => {
    if (pendingSelectRef.current) {
      const { name } = pendingSelectRef.current;
      const index = wrappedRegisters.findIndex((w) => w.model.name === name);
      if (index >= 0) {
        editor.selectRow(index, 'name');
        pendingSelectRef.current = null;
      }
    }
  }, [wrappedRegisters, editor]);

  // ---- Seed the active register from an out-of-band selection (Outline) ----
  const appliedActiveRegRef = useRef<number | null>(null);
  useEffect(() => {
    appliedActiveRegRef.current = null;
  }, [block?.name]);
  useEffect(() => {
    const i = selectionMeta?.activeRegisterIndex;
    if (typeof i !== 'number' || appliedActiveRegRef.current === i) {
      return;
    }
    if (i >= 0 && i < wrappedRegisters.length) {
      editor.selectRow(i);
      appliedActiveRegRef.current = i;
    }
  }, [selectionMeta?.activeRegisterIndex, wrappedRegisters, editor]);

  useAutoFocus(
    editor.containerRef as React.RefObject<HTMLDivElement>,
    !!selectionMeta?.focusDetails,
    [block?.name]
  );

  const insertAtGap = (
    gapIndex: number,
    kind: 'register' | 'flat-array' | 'array' = 'register'
  ) => {
    insertNewItem(gapIndex, kind);
    editor.clearInsertBar();
  };

  const closeContextMenu = () => setContextMenu(null);

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
      pendingSelectRef.current = { name: arrayName };
      onUpdate(['registers'], newRegs as unknown[]);
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [liveRegisters, onUpdate, editor]);

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

  const activeReg = editor.selectedIndex >= 0 ? registers[editor.selectedIndex] : undefined;

  const rail = (
    <div
      ref={editor.containerRef as React.RefObject<HTMLDivElement>}
      tabIndex={0}
      data-regs-table="true"
      className="outline-none focus:outline-none"
    >
      <RegisterMapVisualizer
        registers={registers}
        hoveredRegIndex={editor.hoveredIndex}
        setHoveredRegIndex={editor.setHoveredFieldIndex}
        selectedRegIndex={editor.selectedIndex}
        onSelectRegister={editor.selectRow}
        baseAddress={baseAddress}
        onReorderRegisters={(newRegs) => onUpdate(['registers'], newRegs as unknown[])}
        onRegisterClick={(idx) => {
          // Arrays open in their own dedicated editor; plain registers edit in place.
          if (isArrayReg(registers[idx])) {
            onNavigateToRegister?.(idx);
          }
        }}
        cardDoubleClickHint={undefined}
        onInsertAtGap={insertAtGap}
        onDeleteReg={(idx) => {
          const rowId = wrappedRegisters[idx]?.rowId;
          if (rowId) {
            deleteReg(rowId);
          }
        }}
        onUpdateRegister={onUpdate}
        cancelEditRef={editor.cancelEditRef}
        captureEditSnapshot={editor.captureEditSnapshot}
        layout="vertical"
      />
    </div>
  );

  let detail: React.ReactNode;
  if (!activeReg) {
    detail = (
      <div className="flex items-center justify-center h-full vscode-muted text-sm px-6 text-center">
        {registers.length === 0
          ? 'No registers yet. Press o to add one.'
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
            onClick={() => onNavigateToRegister(editor.selectedIndex)}
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
    <TwoPanelEditorLayout
      header={
        <EditorHeader
          title={block?.name ?? 'Address Block'}
          description={`${block?.description ?? `Base: ${toHex(baseAddress)}`} • ${block?.usage ?? 'register'}`}
          layout={registerLayout}
          onToggleLayout={toggleRegisterLayout}
        />
      }
      visualizer={rail}
      table={detail}
      footer={
        <>
          <KeyboardShortcutsButton context="block" />
          <RegisterActionsMenu
            position={contextMenu ? { x: contextMenu.x, y: contextMenu.y } : null}
            onInsert={(where, kind) => {
              const idx = wrappedRegisters.findIndex((w) => w.rowId === contextMenu!.regId);
              insertAtGap(where === 'above' ? idx : idx + 1, kind);
            }}
            onDelete={() => deleteReg(contextMenu!.regId)}
            onClose={closeContextMenu}
          />
        </>
      }
      layout="side-by-side"
    />
  );
}
