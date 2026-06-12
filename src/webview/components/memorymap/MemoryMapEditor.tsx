import React, { useRef, useState } from 'react';
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
import { BlockTableRow, BLOCK_COLUMN_ORDER } from './BlockTableRow';
import type { BlockEditKey } from './BlockTableRow';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MemoryMapBlockDef extends AddressBlockRuntimeDef {
  usage?: string;
  description?: string;
}

export interface MemoryMapEditorProps {
  /** The memory map object (has name, description, address_blocks / addressBlocks). */
  memoryMap: {
    name?: string;
    description?: string;
    address_blocks?: MemoryMapBlockDef[];
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
  const blocks = memoryMap?.address_blocks ?? memoryMap?.addressBlocks ?? [];

  const [insertError, setInsertError] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    blockIndex: number;
  } | null>(null);

  const tbodyRef = useRef<HTMLTableSectionElement | null>(null);

  const liveBlocks = memoryMap?.address_blocks ?? memoryMap?.addressBlocks ?? [];

  const insertAtGap = (gapIndex: number) => {
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
    onUpdate(['addressBlocks'], result.items);
    editor.selectRow(newIdx, 'name');
    editor.clearInsertBar();
    window.setTimeout(() => {
      document.querySelector(`tr[data-row-idx="${newIdx}"]`)?.scrollIntoView({ block: 'center' });
    }, 100);
  };

  const deleteBlock = (idx: number) => {
    if (idx < 0 || idx >= liveBlocks.length) {
      return;
    }
    const newBlocks = liveBlocks.filter((_: unknown, i: number) => i !== idx);
    onUpdate(['addressBlocks'], newBlocks);
    const nextRow = idx > 0 ? idx - 1 : newBlocks.length > 0 ? 0 : -1;
    editor.selectRow(nextRow, editor.activeCell.key);
  };

  const tryInsertBlock = (after: boolean) => {
    const gapIndex = after
      ? editor.selectedIndex < 0
        ? liveBlocks.length
        : editor.selectedIndex + 1
      : editor.selectedIndex < 0
        ? 0
        : editor.selectedIndex;
    insertAtGap(gapIndex);
  };

  const editor = useTableEditorState<MemoryMapBlockDef, BlockEditKey>({
    rows: liveBlocks,
    rowsPath: ['addressBlocks'],
    columnOrder: BLOCK_COLUMN_ORDER,
    onUpdate,
    rowSelectorAttr: 'data-block-idx',
    onInsertAfter: () => tryInsertBlock(true),
    onInsertBefore: () => tryInsertBlock(false),
    onDelete: deleteBlock,
    enableHoverInsert: true,
    clampDeps: [memoryMap?.name],
  });

  useAutoFocus(
    editor.containerRef as React.RefObject<HTMLDivElement>,
    !!selectionMeta?.focusDetails,
    [memoryMap?.name]
  );

  const closeContextMenu = () => setContextMenu(null);

  const getBlockColor = (idx: number) => FIELD_COLOR_KEYS[idx % FIELD_COLOR_KEYS.length];

  const visualizer = (
    <AddressMapVisualizer
      blocks={blocks}
      hoveredBlockIndex={editor.hoveredIndex}
      setHoveredBlockIndex={editor.setHoveredIndex}
      onBlockClick={onNavigateToBlock}
      onInsertAtGap={insertAtGap}
      onDeleteBlock={deleteBlock}
      layout={memoryMapLayout === 'side-by-side' ? 'vertical' : 'horizontal'}
    />
  );

  const blocksTable = (
    <div
      ref={editor.containerRef as React.RefObject<HTMLDivElement>}
      tabIndex={0}
      data-blocks-table="true"
      className="flex-1 overflow-auto min-h-0 outline-none focus:outline-none relative"
    >
      {insertError ? <div className="vscode-error px-4 py-2 text-xs">{insertError}</div> : null}
      <table className="w-full text-left border-collapse table-fixed">
        <colgroup>
          <col className="w-[25%] min-w-[200px]" />
          <col className="w-[20%] min-w-[120px]" />
          <col className="w-[15%] min-w-[100px]" />
          <col className="w-[15%] min-w-[100px]" />
          <col className="w-[25%]" />
        </colgroup>
        <thead className="vscode-surface-alt text-xs font-semibold vscode-muted uppercase tracking-wider sticky top-0 z-10 shadow-sm">
          <tr className="h-12">
            <th className="px-6 py-3 border-b vscode-border align-middle">Name</th>
            <th className="px-4 py-3 border-b vscode-border align-middle">Base Address</th>
            <th className="px-4 py-3 border-b vscode-border align-middle">Size</th>
            <th className="px-4 py-3 border-b vscode-border align-middle">Usage</th>
            <th className="px-6 py-3 border-b vscode-border align-middle">Description</th>
          </tr>
        </thead>
        <tbody ref={tbodyRef} className="text-sm" {...editor.insertBarTbodyProps}>
          {blocks.map((block: MemoryMapBlockDef, idx: number) => (
            <BlockTableRow
              key={idx}
              block={block}
              idx={idx}
              isSelected={idx === editor.selectedIndex}
              isHovered={idx === editor.hoveredIndex}
              blockActiveCell={editor.activeCell}
              color={getBlockColor(idx)}
              cancelEditRef={editor.cancelEditRef}
              captureEditSnapshot={editor.captureEditSnapshot}
              onUpdate={onUpdate}
              onRowClick={() => editor.handleRowClick(idx)}
              onCellClick={(key) => editor.handleCellClick(idx, key)}
              onMouseEnter={() => editor.handleMouseEnter(idx)}
              onMouseLeave={editor.handleMouseLeave}
              onContextMenu={(e) => {
                e.preventDefault();
                setContextMenu({ x: e.clientX, y: e.clientY, blockIndex: idx });
              }}
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
            onInsertAbove={() => insertAtGap(contextMenu!.blockIndex)}
            onInsertBelow={() => insertAtGap(contextMenu!.blockIndex + 1)}
            onDelete={() => deleteBlock(contextMenu!.blockIndex)}
            onClose={closeContextMenu}
          />
        </>
      }
      layout={memoryMapLayout}
    />
  );
}
