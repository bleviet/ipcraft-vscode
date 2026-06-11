import React, { useEffect, useRef, useState } from 'react';
import type { YamlUpdateHandler } from '../../types/editor';
import { VSCodeTextField, VSCodeTextArea } from '@vscode/webview-ui-toolkit/react';
import {
  KeyboardShortcutsButton,
  EditorHeader,
  TwoPanelEditorLayout,
  HoverInsertBar,
  TableContextMenu,
} from '../../shared/components';
import AddressMapVisualizer from '../AddressMapVisualizer';
import { FIELD_COLORS, FIELD_COLOR_KEYS } from '../../shared/colors';
import {
  SpatialInsertionService,
  AddressBlockRuntimeDef,
} from '../../services/SpatialInsertionService';
import { calculateBlockSize } from '../../utils/blockSize';
import { toHex } from '../../utils/formatUtils';
import { useAutoFocus } from '../../hooks/useAutoFocus';
import { useTableNavigation } from '../../hooks/useTableNavigation';
import { useCellEditGuard } from '../../hooks/useCellEditGuard';
import { useHoverInsertBar } from '../../hooks/useHoverInsertBar';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type BlockEditKey = 'name' | 'base' | 'size' | 'usage' | 'description';
type BlockActiveCell = { rowIndex: number; key: BlockEditKey };
const BLOCK_COLUMN_ORDER: BlockEditKey[] = ['name', 'base', 'size', 'usage', 'description'];

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
// Helpers
// ---------------------------------------------------------------------------

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

  const [selectedBlockIndex, setSelectedBlockIndex] = useState<number>(-1);
  const [hoveredBlockIndex, setHoveredBlockIndex] = useState<number | null>(null);
  const [blockActiveCell, setBlockActiveCell] = useState<BlockActiveCell>({
    rowIndex: -1,
    key: 'name',
  });
  const [insertError, setInsertError] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    blockIndex: number;
  } | null>(null);

  const focusRef = useRef<HTMLDivElement | null>(null);
  const tbodyRef = useRef<HTMLTableSectionElement | null>(null);

  useAutoFocus(focusRef, !!selectionMeta?.focusDetails, [memoryMap?.name]);

  // Clamp selection when map changes.
  useEffect(() => {
    const currentBlocks = memoryMap?.address_blocks ?? memoryMap?.addressBlocks ?? [];
    if (!Array.isArray(currentBlocks) || currentBlocks.length === 0) {
      setSelectedBlockIndex(-1);
      setBlockActiveCell({ rowIndex: -1, key: 'name' });
      return;
    }
    setSelectedBlockIndex((prev) => {
      if (prev < 0) {
        return 0;
      }
      if (prev >= currentBlocks.length) {
        return currentBlocks.length - 1;
      }
      return prev;
    });
    setBlockActiveCell((prev) => {
      const rowIndex = prev.rowIndex < 0 ? 0 : Math.min(currentBlocks.length - 1, prev.rowIndex);
      const key = BLOCK_COLUMN_ORDER.includes(prev.key) ? prev.key : 'name';
      return { rowIndex, key };
    });
  }, [memoryMap?.name, (memoryMap?.address_blocks ?? memoryMap?.addressBlocks ?? []).length]);

  const liveBlocks = memoryMap?.address_blocks ?? memoryMap?.addressBlocks ?? [];

  const { cancelEditRef, captureEditSnapshot } = useCellEditGuard({
    rows: liveBlocks,
    rowsPath: ['addressBlocks'],
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
    setSelectedBlockIndex(newIdx);
    setHoveredBlockIndex(newIdx);
    setBlockActiveCell({ rowIndex: newIdx, key: 'name' });
    clearInsertBar();
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
    setSelectedBlockIndex(nextRow);
    setHoveredBlockIndex(nextRow);
    setBlockActiveCell({ rowIndex: nextRow, key: 'name' });
  };

  const closeContextMenu = () => setContextMenu(null);

  const tryInsertBlock = (after: boolean) => {
    const gapIndex = after
      ? selectedBlockIndex < 0
        ? liveBlocks.length
        : selectedBlockIndex + 1
      : selectedBlockIndex < 0
        ? 0
        : selectedBlockIndex;
    insertAtGap(gapIndex);
  };

  useTableNavigation<BlockEditKey>({
    activeCell: blockActiveCell,
    setActiveCell: (cell) => {
      setBlockActiveCell(cell);
      if (cell.rowIndex >= 0 && cell.rowIndex < liveBlocks.length) {
        setSelectedBlockIndex(cell.rowIndex);
        setHoveredBlockIndex(cell.rowIndex);
      }
    },
    rowCount: liveBlocks.length,
    columnOrder: BLOCK_COLUMN_ORDER,
    containerRef: focusRef as React.RefObject<HTMLElement>,
    onEdit: (rowIndex, key) => {
      if (rowIndex < 0 || rowIndex >= liveBlocks.length) {
        return;
      }
      setSelectedBlockIndex(rowIndex);
      setHoveredBlockIndex(rowIndex);
      setBlockActiveCell({ rowIndex, key });
      window.setTimeout(() => {
        const row = document.querySelector(`tr[data-row-idx="${rowIndex}"]`);
        const editor = row?.querySelector(`[data-edit-key="${key}"]`) as HTMLElement | null;
        editor?.focus?.();
      }, 0);
    },
    onDelete: (rowIndex) => deleteBlock(rowIndex),
    onInsertAfter: () => tryInsertBlock(true),
    onInsertBefore: () => tryInsertBlock(false),
    isActive: true,
    rowSelectorAttr: 'data-block-idx',
  });

  const getBlockColor = (idx: number) => FIELD_COLOR_KEYS[idx % FIELD_COLOR_KEYS.length];

  const visualizer = (
    <AddressMapVisualizer
      blocks={blocks}
      hoveredBlockIndex={hoveredBlockIndex}
      setHoveredBlockIndex={setHoveredBlockIndex}
      onBlockClick={onNavigateToBlock}
      onInsertAtGap={insertAtGap}
      onDeleteBlock={deleteBlock}
      layout={memoryMapLayout === 'side-by-side' ? 'vertical' : 'horizontal'}
    />
  );

  const blocksTable = (
    <div
      ref={focusRef}
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
        <tbody ref={tbodyRef} className="text-sm" {...insertBarTbodyProps}>
          {blocks.map((block: MemoryMapBlockDef, idx: number) => {
            const color = getBlockColor(idx);
            const base = block.base_address ?? block.offset ?? 0;
            const size = calculateBlockSize(block);

            return (
              <tr
                key={idx}
                data-row-idx={idx}
                data-block-idx={idx}
                className={`group transition-colors border-l-4 border-transparent border-b vscode-border h-12 ${
                  idx === selectedBlockIndex
                    ? 'vscode-focus-border vscode-row-selected'
                    : idx === hoveredBlockIndex
                      ? 'vscode-focus-border vscode-row-hover'
                      : ''
                }`}
                onMouseEnter={() => setHoveredBlockIndex(idx)}
                onMouseLeave={() => setHoveredBlockIndex(null)}
                onClick={() => {
                  setSelectedBlockIndex(idx);
                  setHoveredBlockIndex(idx);
                  setBlockActiveCell((prev) => ({ rowIndex: idx, key: prev.key }));
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setContextMenu({ x: e.clientX, y: e.clientY, blockIndex: idx });
                }}
              >
                <td
                  data-col-key="name"
                  className={`px-6 py-2 font-medium align-middle ${
                    blockActiveCell.rowIndex === idx && blockActiveCell.key === 'name'
                      ? 'vscode-cell-active'
                      : ''
                  }`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedBlockIndex(idx);
                    setHoveredBlockIndex(idx);
                    setBlockActiveCell({ rowIndex: idx, key: 'name' });
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
                      value={block.name || ''}
                      onFocus={() => captureEditSnapshot()}
                      onBlur={(e: Event | React.FocusEvent<HTMLElement>) => {
                        if (cancelEditRef.current) {
                          return;
                        }
                        onUpdate(
                          ['addressBlocks', idx, 'name'],
                          (e.target as HTMLInputElement).value
                        );
                      }}
                    />
                  </div>
                </td>
                <td
                  data-col-key="base"
                  className={`px-4 py-2 font-mono vscode-muted align-middle ${
                    blockActiveCell.rowIndex === idx && blockActiveCell.key === 'base'
                      ? 'vscode-cell-active'
                      : ''
                  }`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedBlockIndex(idx);
                    setHoveredBlockIndex(idx);
                    setBlockActiveCell({ rowIndex: idx, key: 'base' });
                  }}
                >
                  <VSCodeTextField
                    data-edit-key="base"
                    className="w-full font-mono"
                    value={toHex(base)}
                    onFocus={() => captureEditSnapshot()}
                    onInput={(e: Event | React.FormEvent<HTMLElement>) => {
                      const val = Number((e.target as HTMLInputElement).value);
                      if (!Number.isNaN(val)) {
                        onUpdate(['addressBlocks', idx, 'base_address'], val);
                      }
                    }}
                  />
                </td>
                <td
                  data-col-key="size"
                  className={`px-4 py-2 font-mono vscode-muted align-middle ${
                    blockActiveCell.rowIndex === idx && blockActiveCell.key === 'size'
                      ? 'vscode-cell-active'
                      : ''
                  }`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedBlockIndex(idx);
                    setHoveredBlockIndex(idx);
                    setBlockActiveCell({ rowIndex: idx, key: 'size' });
                  }}
                >
                  {size < 1024 ? `${size}B` : `${(size / 1024).toFixed(1)}KB`}
                </td>
                <td
                  data-col-key="usage"
                  className={`px-4 py-2 align-middle ${
                    blockActiveCell.rowIndex === idx && blockActiveCell.key === 'usage'
                      ? 'vscode-cell-active'
                      : ''
                  }`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedBlockIndex(idx);
                    setHoveredBlockIndex(idx);
                    setBlockActiveCell({ rowIndex: idx, key: 'usage' });
                  }}
                >
                  <span className="px-2 py-0.5 rounded text-xs font-medium vscode-badge whitespace-nowrap">
                    {block.usage ?? 'register'}
                  </span>
                </td>
                <td
                  data-col-key="description"
                  className={`px-6 py-2 vscode-muted align-middle ${
                    blockActiveCell.rowIndex === idx && blockActiveCell.key === 'description'
                      ? 'vscode-cell-active'
                      : ''
                  }`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedBlockIndex(idx);
                    setHoveredBlockIndex(idx);
                    setBlockActiveCell({ rowIndex: idx, key: 'description' });
                  }}
                >
                  <VSCodeTextArea
                    data-edit-key="description"
                    className="w-full"
                    rows={1}
                    value={block.description ?? ''}
                    onFocus={() => captureEditSnapshot()}
                    onInput={(e: Event | React.FormEvent<HTMLElement>) =>
                      onUpdate(
                        ['addressBlocks', idx, 'description'],
                        (e.target as HTMLInputElement).value
                      )
                    }
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <HoverInsertBar
        gapIndex={insertHoverGap}
        positionY={insertBarScrollY}
        itemLabel="block"
        onInsert={insertAtGap}
        {...insertBarHoverProps}
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
