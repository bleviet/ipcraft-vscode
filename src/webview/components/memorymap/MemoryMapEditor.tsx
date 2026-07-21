import React, { useEffect, useRef, useState } from 'react';
import type { YamlUpdateHandler } from '../../types/editor';
import {
  KeyboardShortcutsButton,
  EditorHeader,
  TwoPanelEditorLayout,
  HoverInsertBar,
  TableContextMenu,
} from '../../shared/components';
import AddressMapVisualizer from '../AddressMapVisualizer';
import { FIELD_COLOR_KEYS } from '../../shared/colors';
import {
  SpatialInsertionService,
  AddressBlockRuntimeDef,
} from '../../services/SpatialInsertionService';
import { useAutoFocus } from '../../hooks/useAutoFocus';
import { useTableEditorState } from '../../hooks/useTableEditorState';
import { usePendingSelect, type PendingSelectTarget } from '../../hooks/usePendingSelect';
import { BlockTableRow, BLOCK_COLUMN_ORDER } from './BlockTableRow';
import type { BlockEditKey } from './BlockTableRow';
import { reconcileRowIds, type TableRowWrapper } from '../../utils/rowIdentity';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MemoryMapBlockDef extends AddressBlockRuntimeDef {
  usage?: string;
  description?: string;
}

interface DragState {
  active: boolean;
  fromRowId: string | null;
  toRowId: string | null;
  position: 'top' | 'bottom' | 'center' | null;
}

const DRAG_IDLE: DragState = { active: false, fromRowId: null, toRowId: null, position: null };

export interface MemoryMapEditorProps {
  /** The memory map object (has name, description, addressBlocks). */
  memoryMap: {
    name?: string;
    description?: string;
    addressBlocks?: MemoryMapBlockDef[];
    [k: string]: unknown;
  };
  memoryMapLayout: 'stacked' | 'side-by-side';
  toggleMemoryMapLayout: () => void;
  selectionMeta?: {
    absoluteAddress?: number;
    relativeOffset?: number;
    focusDetails?: boolean;
  };
  onUpdate: YamlUpdateHandler;
  onNavigateToBlock?: (blockIndex: number) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Renders and manages editing of a memory map's address blocks,
 * including the AddressMapVisualizer and keyboard-navigable blocks table.
 */
export function MemoryMapEditor({
  memoryMap,
  memoryMapLayout,
  toggleMemoryMapLayout,
  selectionMeta,
  onUpdate,
  onNavigateToBlock,
}: MemoryMapEditorProps) {
  const blocks = memoryMap?.addressBlocks ?? [];

  const [insertError, setInsertError] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    blockId: string;
  } | null>(null);

  const tbodyRef = useRef<HTMLTableSectionElement | null>(null);

  const liveBlocks = memoryMap?.addressBlocks ?? [];

  // ---- wrapped rows for row identity ----
  const [wrappedBlocks, setWrappedBlocks] = useState<Array<TableRowWrapper<MemoryMapBlockDef>>>([]);

  useEffect(() => {
    setWrappedBlocks((prev) => reconcileRowIds(prev, liveBlocks));
  }, [liveBlocks]);

  const insertAtGap = (gapIndex: number, autoFocus = true) => {
    setInsertError(null);
    const result =
      gapIndex === 0
        ? SpatialInsertionService.insertBlock('before', liveBlocks, 0)
        : SpatialInsertionService.insertBlock('after', liveBlocks, gapIndex - 1);
    if (result.error) {
      setInsertError(result.error);
      return;
    }
    const newIdx = result.newIndex;
    const name = result.items[newIdx].name ?? '';
    if (autoFocus) {
      pendingInsertFocusRef.current = { name, key: 'name' };
    } else {
      pendingSelectRef.current = { name, key: 'name' };
    }
    onUpdate(['addressBlocks'], result.items);
    editor.clearInsertBar();
  };

  const deleteBlock = (rowId: string) => {
    const idx = wrappedBlocks.findIndex((w) => w.rowId === rowId);
    if (idx < 0 || idx >= liveBlocks.length) {
      return;
    }
    const newBlocks = liveBlocks.filter((_: unknown, i: number) => i !== idx);
    onUpdate(['addressBlocks'], newBlocks);
    const nextRow = idx < newBlocks.length ? idx : newBlocks.length - 1;
    window.setTimeout(() => {
      editor.selectRow(nextRow, editor.activeCell.key);
    }, 0);
  };

  const tryInsertBlock = (after: boolean) => {
    const gapIndex = after
      ? editor.selectedIndex < 0
        ? liveBlocks.length
        : editor.selectedIndex + 1
      : editor.selectedIndex < 0
        ? 0
        : editor.selectedIndex;
    insertAtGap(gapIndex, false);
  };

  const editor = useTableEditorState<MemoryMapBlockDef, BlockEditKey>({
    rows: wrappedBlocks,
    rowsPath: ['addressBlocks'],
    columnOrder: BLOCK_COLUMN_ORDER,
    onUpdate,
    rowSelectorAttr: 'data-row-id',
    onInsertAfter: () => tryInsertBlock(true),
    onInsertBefore: () => tryInsertBlock(false),
    onDelete: deleteBlock,
    enableHoverInsert: true,
    clampDeps: [memoryMap?.name],
  });

  const pendingInsertFocusRef = useRef<PendingSelectTarget<BlockEditKey> | null>(null);
  const pendingSelectRef = useRef<PendingSelectTarget<BlockEditKey> | null>(null);

  usePendingSelect<MemoryMapBlockDef, BlockEditKey>(
    wrappedBlocks,
    editor,
    pendingSelectRef,
    pendingInsertFocusRef
  );

  useAutoFocus(
    editor.containerRef as React.RefObject<HTMLDivElement>,
    !!selectionMeta?.focusDetails,
    [memoryMap?.name]
  );

  const closeContextMenu = () => setContextMenu(null);

  const getBlockColor = (idx: number) => FIELD_COLOR_KEYS[idx % FIELD_COLOR_KEYS.length];

  const [dragState, setDragState] = useState<DragState>(DRAG_IDLE);

  const handleDragHandlePointerDown = (rowId: string, e: React.PointerEvent) => {
    if (e.button !== 0) {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    setDragState({ active: true, fromRowId: rowId, toRowId: rowId, position: 'center' });
  };

  const handleDragEnterRow = (rowId: string) => {
    if (!dragState.active) {
      return;
    }
    setDragState((prev) => ({ ...prev, toRowId: rowId }));
  };

  const handleDragMove = (rowId: string, e: React.PointerEvent) => {
    if (!dragState.active) {
      return;
    }

    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const y = e.clientY - rect.top;
    const height = rect.height;

    let pos: 'top' | 'bottom' | 'center' = 'center';
    if (y < height * 0.25) {
      pos = 'top';
    } else if (y > height * 0.75) {
      pos = 'bottom';
    }

    setDragState((prev) => {
      if (prev.toRowId === rowId && prev.position === pos) {
        return prev;
      }
      return { ...prev, toRowId: rowId, position: pos };
    });
  };

  useEffect(() => {
    if (!dragState.active) {
      return;
    }
    const commit = () => {
      const { fromRowId, toRowId, position } = dragState;
      if (fromRowId && toRowId) {
        const fromIdx = wrappedBlocks.findIndex((w) => w.rowId === fromRowId);
        const toIdx = wrappedBlocks.findIndex((w) => w.rowId === toRowId);
        if (fromIdx >= 0 && toIdx >= 0 && (fromIdx !== toIdx || position !== 'center')) {
          const newBlocks = [...liveBlocks];
          if (position === 'center') {
            // SWAP
            const temp = newBlocks[fromIdx];
            newBlocks[fromIdx] = newBlocks[toIdx];
            newBlocks[toIdx] = temp;
          } else {
            // INSERT
            let insertIdx = toIdx;
            if (position === 'bottom') {
              insertIdx++;
            }
            const [moved] = newBlocks.splice(fromIdx, 1);
            if (fromIdx < insertIdx) {
              insertIdx--;
            }
            newBlocks.splice(insertIdx, 0, moved);
          }
          onUpdate(['addressBlocks'], newBlocks);
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
  }, [dragState, wrappedBlocks, liveBlocks, onUpdate]);

  const visualizer = (
    <AddressMapVisualizer
      blocks={blocks}
      hoveredBlockIndex={editor.hoveredIndex}
      setHoveredBlockIndex={editor.setHoveredFieldIndex}
      onBlockClick={onNavigateToBlock}
      onInsertAtGap={insertAtGap}
      onDeleteBlock={(idx) => {
        const rowId = wrappedBlocks[idx]?.rowId;
        if (rowId) {
          deleteBlock(rowId);
        }
      }}
      layout={memoryMapLayout === 'side-by-side' ? 'vertical' : 'horizontal'}
    />
  );

  const blocksTable = (
    <div
      ref={editor.containerRef as React.RefObject<HTMLDivElement>}
      tabIndex={0}
      data-blocks-table="true"
      className={`flex-1 overflow-auto min-h-0 outline-none focus:outline-none relative${dragState.active ? ' cursor-grabbing select-none' : ''}`}
    >
      {insertError ? <div className="vscode-error px-4 py-2 text-xs">{insertError}</div> : null}
      <table className="w-full text-left border-collapse table-fixed">
        <colgroup>
          <col className="w-8" />
          <col className="w-[22%] min-w-[160px]" />
          <col className="w-[13%] min-w-[100px]" />
          <col className="w-[9%] min-w-[70px]" />
          <col className="w-[18%] min-w-[140px]" />
          <col className="w-[12%] min-w-[90px]" />
          <col className="w-[26%]" />
        </colgroup>
        <thead className="vscode-surface-alt text-xs font-semibold vscode-muted uppercase tracking-wider sticky top-0 z-10 shadow-sm">
          <tr className="h-12">
            <th className="w-8 border-b vscode-border" />
            <th className="px-6 py-3 border-b vscode-border align-middle">Name</th>
            <th className="px-4 py-3 border-b vscode-border align-middle">Base Address</th>
            <th className="px-4 py-3 border-b vscode-border align-middle">Size</th>
            <th className="px-4 py-3 border-b vscode-border align-middle">Address Range</th>
            <th className="px-4 py-3 border-b vscode-border align-middle">Usage</th>
            <th className="px-6 py-3 border-b vscode-border align-middle">Description</th>
          </tr>
        </thead>
        <tbody ref={tbodyRef} className="text-sm" {...editor.insertBarTbodyProps}>
          {wrappedBlocks.map((wrapped: TableRowWrapper<MemoryMapBlockDef>, idx: number) => (
            <BlockTableRow
              key={wrapped.rowId}
              block={wrapped.model}
              rowId={wrapped.rowId}
              idx={idx}
              isSelected={wrapped.rowId === editor.selectedRowId}
              isHovered={wrapped.rowId === editor.hoveredRowId}
              blockActiveCell={editor.activeCell}
              color={getBlockColor(idx)}
              cancelEditRef={editor.cancelEditRef}
              captureEditSnapshot={editor.captureEditSnapshot}
              onUpdate={onUpdate}
              onRowClick={() => editor.selectRow(idx)}
              onCellClick={(key) => editor.selectRow(idx, key)}
              onMouseEnter={() => editor.setHoveredRowId(wrapped.rowId)}
              onMouseLeave={() => editor.setHoveredRowId(null)}
              onContextMenu={(e) => {
                e.preventDefault();
                setContextMenu({ x: e.clientX, y: e.clientY, blockId: wrapped.rowId });
              }}
              isDragSource={dragState.active && dragState.fromRowId === wrapped.rowId}
              isDragTarget={
                dragState.active &&
                dragState.fromRowId !== wrapped.rowId &&
                dragState.toRowId === wrapped.rowId
              }
              dragTargetPosition={
                dragState.active &&
                dragState.fromRowId !== wrapped.rowId &&
                dragState.toRowId === wrapped.rowId
                  ? dragState.position
                  : null
              }
              onDragHandlePointerDown={(e) => handleDragHandlePointerDown(wrapped.rowId, e)}
              onPointerEnterRow={() => handleDragEnterRow(wrapped.rowId)}
              onDragMove={handleDragMove}
              siblingNames={liveBlocks
                .filter((_: unknown, i: number) => i !== idx)
                .map((b: unknown) => String((b as MemoryMapBlockDef).name ?? ''))}
            />
          ))}
        </tbody>
      </table>
      <HoverInsertBar
        gapIndex={editor.insertHoverGap}
        positionY={editor.insertBarScrollY}
        itemLabel="block"
        onInsert={insertAtGap}
        {...editor.insertBarHoverProps}
      />
    </div>
  );

  return (
    <TwoPanelEditorLayout
      header={
        <EditorHeader
          title={memoryMap?.name ?? 'Memory Map'}
          description={memoryMap?.description ?? 'Address space layout'}
          layout={memoryMapLayout}
          onToggleLayout={toggleMemoryMapLayout}
        />
      }
      visualizer={visualizer}
      table={blocksTable}
      footer={
        <>
          <KeyboardShortcutsButton context="memoryMap" />
          <TableContextMenu
            position={contextMenu ? { x: contextMenu.x, y: contextMenu.y } : null}
            onInsertAbove={() => {
              const idx = wrappedBlocks.findIndex((w) => w.rowId === contextMenu!.blockId);
              insertAtGap(idx);
            }}
            onInsertBelow={() => {
              const idx = wrappedBlocks.findIndex((w) => w.rowId === contextMenu!.blockId);
              insertAtGap(idx + 1);
            }}
            onDelete={() => deleteBlock(contextMenu!.blockId)}
            onClose={closeContextMenu}
          />
        </>
      }
      layout={memoryMapLayout}
    />
  );
}
