import React, { useEffect, useRef, useState } from 'react';
import type { YamlUpdateHandler } from '../../types/editor';
import { VSCodeTextField, VSCodeTextArea } from '@vscode/webview-ui-toolkit/react';
import { KeyboardShortcutsButton } from '../../shared/components';
import AddressMapVisualizer from '../AddressMapVisualizer';
import { FIELD_COLORS, FIELD_COLOR_KEYS } from '../../shared/colors';
import {
  SpatialInsertionService,
  AddressBlockRuntimeDef,
} from '../../services/SpatialInsertionService';
import { calculateBlockSize } from '../../utils/blockSize';
import { toHex } from '../../utils/formatUtils';
import { useAutoFocus } from '../../hooks/useAutoFocus';
import { useEscapeFocus } from '../../hooks/useEscapeFocus';
import { useTableNavigation } from '../../hooks/useTableNavigation';

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

  const focusRef = useRef<HTMLDivElement | null>(null);

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

  useEscapeFocus(focusRef);

  const liveBlocks = memoryMap?.address_blocks ?? memoryMap?.addressBlocks ?? [];

  const tryInsertBlock = (after: boolean) => {
    setInsertError(null);
    const result = SpatialInsertionService.insertBlock(
      after ? 'after' : 'before',
      liveBlocks,
      selectedBlockIndex
    );

    if (result.error) {
      setInsertError(result.error);
      return;
    }

    const newIdx = result.newIndex;
    onUpdate(['addressBlocks'], result.items);
    setSelectedBlockIndex(newIdx);
    setHoveredBlockIndex(newIdx);
    setBlockActiveCell({ rowIndex: newIdx, key: 'name' });
    window.setTimeout(() => {
      document.querySelector(`tr[data-row-idx="${newIdx}"]`)?.scrollIntoView({ block: 'center' });
    }, 100);
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
    onDelete: (rowIndex) => {
      if (rowIndex < 0 || rowIndex >= liveBlocks.length) {
        return;
      }
      const currentKey: BlockEditKey = BLOCK_COLUMN_ORDER.includes(blockActiveCell.key)
        ? blockActiveCell.key
        : 'name';
      const newBlocks = liveBlocks.filter((_: unknown, i: number) => i !== rowIndex);
      onUpdate(['addressBlocks'], newBlocks);
      const nextRow = rowIndex > 0 ? rowIndex - 1 : newBlocks.length > 0 ? 0 : -1;
      setSelectedBlockIndex(nextRow);
      setHoveredBlockIndex(nextRow);
      setBlockActiveCell({ rowIndex: nextRow, key: currentKey });
    },
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
      layout={memoryMapLayout === 'side-by-side' ? 'vertical' : 'horizontal'}
    />
  );

  const blocksTable = (
    <div
      ref={focusRef}
      tabIndex={0}
      data-blocks-table="true"
      className="flex-1 overflow-auto min-h-0 outline-none focus:outline-none"
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
        <tbody className="divide-y vscode-border text-sm">
          {blocks.map((block: MemoryMapBlockDef, idx: number) => {
            const color = getBlockColor(idx);
            const base = block.base_address ?? block.offset ?? 0;
            const size = calculateBlockSize(block);

            return (
              <tr
                key={idx}
                data-row-idx={idx}
                data-block-idx={idx}
                className={`group transition-colors border-l-4 border-transparent h-12 ${
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
                      onBlur={(e: Event | React.FocusEvent<HTMLElement>) =>
                        onUpdate(
                          ['addressBlocks', idx, 'name'],
                          (e.target as HTMLInputElement).value
                        )
                      }
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
                    onInput={(e: Event | React.FormEvent<HTMLElement>) => {
                      const val = Number((e.target as HTMLInputElement).value);
                      if (!Number.isNaN(val)) {
                        onUpdate(['addressBlocks', idx, 'offset'], val);
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
    </div>
  );

  return (
    <div className="flex flex-col w-full h-full min-h-0">
      <div className="vscode-surface border-b vscode-border px-6 py-2 shrink-0">
        <div className="flex justify-between items-start gap-4">
          <div>
            <h2 className="text-2xl font-bold font-mono tracking-tight">
              {memoryMap?.name ?? 'Memory Map'}
            </h2>
            <p className="vscode-muted text-sm mt-1 max-w-2xl">
              {memoryMap?.description ?? 'Address space layout'}
            </p>
          </div>
          <button
            className="p-2 rounded-md transition-colors vscode-icon-button"
            onClick={toggleMemoryMapLayout}
            title={
              memoryMapLayout === 'stacked'
                ? 'Switch to side-by-side layout'
                : 'Switch to stacked layout'
            }
            aria-label="Toggle memory map layout"
            type="button"
          >
            <span
              className={`codicon ${
                memoryMapLayout === 'stacked'
                  ? 'codicon-split-horizontal'
                  : 'codicon-split-vertical'
              }`}
            />
          </button>
        </div>
      </div>

      {memoryMapLayout === 'side-by-side' ? (
        <div className="flex-1 flex overflow-hidden min-h-0">
          <div className="register-visualizer-pane shrink-0 overflow-y-auto border-r vscode-border">
            {visualizer}
          </div>
          <div className="flex-1 vscode-surface min-h-0 flex flex-col overflow-hidden">
            {blocksTable}
          </div>
        </div>
      ) : (
        <>
          <div className="vscode-surface border-b vscode-border p-8 flex flex-col gap-6 shrink-0 relative overflow-hidden">
            <div className="w-full relative z-10 mt-2 select-none">{visualizer}</div>
          </div>
          <div className="flex-1 flex overflow-hidden min-h-0">
            <div className="flex-1 vscode-surface min-h-0 flex flex-col">{blocksTable}</div>
          </div>
        </>
      )}
      <KeyboardShortcutsButton context="memoryMap" />
    </div>
  );
}
