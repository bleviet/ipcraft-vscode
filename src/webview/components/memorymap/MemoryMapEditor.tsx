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
import { useTableNavigation } from '../../hooks/useTableNavigation';
import { useCellEditGuard } from '../../hooks/useCellEditGuard';

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
  const [insertHoverGap, setInsertHoverGap] = useState<number | null>(null);
  const [insertBarScrollY, setInsertBarScrollY] = useState<number | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    blockIndex: number;
  } | null>(null);

  const focusRef = useRef<HTMLDivElement | null>(null);
  const tbodyRef = useRef<HTMLTableSectionElement | null>(null);
  const contextMenuRef = useRef<HTMLDivElement | null>(null);
  const insertClearRef = useRef<number | null>(null);

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
    setInsertHoverGap(null);
    setInsertBarScrollY(null);
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
        <tbody
          ref={tbodyRef}
          className="text-sm"
          onMouseMove={handleTbodyMouseMove}
          onMouseLeave={scheduleInsertClear}
        >
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
            title={`Insert block at position ${insertHoverGap}`}
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
              {memoryMap?.name ?? 'Memory Map'}
            </h2>
            <p className="vscode-muted text-xs mt-0.5 max-w-2xl">
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
              insertAtGap(contextMenu.blockIndex);
              closeContextMenu();
            }}
          >
            <span className="codicon codicon-arrow-up text-xs" />
            Insert Above
          </button>
          <button
            className="w-full text-left px-4 py-2 flex items-center gap-2 cursor-pointer hover:bg-[var(--vscode-list-hoverBackground)] transition-colors"
            onClick={() => {
              insertAtGap(contextMenu.blockIndex + 1);
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
              deleteBlock(contextMenu.blockIndex);
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
