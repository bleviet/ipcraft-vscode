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

/**
 * Calculates block size in bytes based on its registers or explicit size field.
 */
function calculateBlockSize(block: MemoryMapBlockDef): number {
  const registers = block?.registers ?? [];
  if (registers.length === 0) {
    const sz = block?.size ?? block?.range ?? 4;
    return typeof sz === 'string' ? Number.parseInt(sz, 10) || 4 : sz;
  }
  let totalSize = 0;
  for (const reg of registers as Record<string, unknown>[]) {
    if (reg.__kind === 'array') {
      const count = (reg.count as number) || 1;
      const stride = (reg.stride as number) || 4;
      totalSize += count * stride;
    } else {
      totalSize += 4;
    }
  }
  return totalSize;
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

  // Auto-focus on explicit request.
  useEffect(() => {
    if (!selectionMeta?.focusDetails) {
      return;
    }
    const id = window.setTimeout(() => {
      focusRef.current?.focus();
    }, 0);
    return () => window.clearTimeout(id);
  }, [selectionMeta?.focusDetails, memoryMap?.name]);

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

  // Escape: return focus from inline editor back to the table.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') {
        return;
      }
      const activeEl = document.activeElement as HTMLElement | null;
      if (!activeEl) {
        return;
      }
      const inBlocks =
        !!focusRef.current && focusRef.current.contains(activeEl) && activeEl !== focusRef.current;
      if (!inBlocks) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      try {
        activeEl.blur?.();
      } catch {
        // ignore
      }
      window.setTimeout(() => focusRef.current?.focus(), 0);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Keyboard shortcuts.
  useEffect(() => {
    const liveBlocks = memoryMap?.address_blocks ?? memoryMap?.addressBlocks ?? [];

    const tryInsertBlock = (after: boolean) => {
      setInsertError(null);
      const result = after
        ? SpatialInsertionService.insertBlockAfter(liveBlocks, selectedBlockIndex)
        : SpatialInsertionService.insertBlockBefore(liveBlocks, selectedBlockIndex);

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
        document
          .querySelector(`tr[data-block-idx="${newIdx}"]`)
          ?.scrollIntoView({ block: 'center' });
      }, 100);
    };

    const onKeyDown = (e: KeyboardEvent) => {
      let keyLower = (e.key || '').toLowerCase();
      if (e.altKey && e.code) {
        if (e.code === 'KeyH') {
          keyLower = 'h';
        }
        if (e.code === 'KeyJ') {
          keyLower = 'j';
        }
        if (e.code === 'KeyK') {
          keyLower = 'k';
        }
        if (e.code === 'KeyL') {
          keyLower = 'l';
        }
      }
      const vimToArrow: Record<string, 'ArrowLeft' | 'ArrowDown' | 'ArrowUp' | 'ArrowRight'> = {
        h: 'ArrowLeft',
        j: 'ArrowDown',
        k: 'ArrowUp',
        l: 'ArrowRight',
      };
      const normalizedKey: string = vimToArrow[keyLower] ?? e.key;

      const isArrow = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(normalizedKey);
      const isEdit = normalizedKey === 'F2' || keyLower === 'e';
      const isDelete = keyLower === 'd' || e.key === 'Delete';
      const isInsertAfter = keyLower === 'o' && !e.shiftKey;
      const isInsertBefore = keyLower === 'o' && e.shiftKey;
      if (!isArrow && !isEdit && !isDelete && !isInsertAfter && !isInsertBefore) {
        return;
      }
      if (e.ctrlKey || e.metaKey) {
        return;
      }

      const activeEl = document.activeElement as HTMLElement | null;
      const isInBlocksArea =
        !!focusRef.current &&
        !!activeEl &&
        (activeEl === focusRef.current || focusRef.current.contains(activeEl));
      if (!isInBlocksArea) {
        return;
      }

      const target = e.target as HTMLElement | null;
      const isTypingTarget = !!target?.closest(
        'input, textarea, select, [contenteditable="true"], vscode-text-field, vscode-text-area, vscode-dropdown'
      );
      if (isTypingTarget) {
        return;
      }

      const scrollToCell = (rowIndex: number, key: BlockEditKey) => {
        window.setTimeout(() => {
          const row = document.querySelector(`tr[data-block-idx="${rowIndex}"]`);
          row?.scrollIntoView({ block: 'nearest' });
          const cell = row?.querySelector(`td[data-col-key="${key}"]`) as HTMLElement | null;
          cell?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        }, 0);
      };

      const focusEditor = (rowIndex: number, key: BlockEditKey) => {
        window.setTimeout(() => {
          const row = document.querySelector(`tr[data-block-idx="${rowIndex}"]`);
          const editor = row?.querySelector(`[data-edit-key="${key}"]`) as HTMLElement | null;
          editor?.focus?.();
        }, 0);
      };

      const currentRow =
        blockActiveCell.rowIndex >= 0
          ? blockActiveCell.rowIndex
          : selectedBlockIndex >= 0
            ? selectedBlockIndex
            : 0;
      const currentKey: BlockEditKey = BLOCK_COLUMN_ORDER.includes(blockActiveCell.key)
        ? blockActiveCell.key
        : 'name';

      if (isEdit) {
        if (currentRow < 0 || currentRow >= liveBlocks.length) {
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        setSelectedBlockIndex(currentRow);
        setHoveredBlockIndex(currentRow);
        setBlockActiveCell({ rowIndex: currentRow, key: currentKey });
        focusEditor(currentRow, currentKey);
        return;
      }
      if (isInsertAfter || isInsertBefore) {
        e.preventDefault();
        e.stopPropagation();
        tryInsertBlock(isInsertAfter);
        return;
      }
      if (isDelete) {
        if (currentRow < 0 || currentRow >= liveBlocks.length) {
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        const newBlocks = liveBlocks.filter((_: unknown, i: number) => i !== currentRow);
        onUpdate(['addressBlocks'], newBlocks);
        const nextRow = currentRow > 0 ? currentRow - 1 : newBlocks.length > 0 ? 0 : -1;
        setSelectedBlockIndex(nextRow);
        setHoveredBlockIndex(nextRow);
        setBlockActiveCell({ rowIndex: nextRow, key: currentKey });
        return;
      }

      e.preventDefault();
      e.stopPropagation();
      if (liveBlocks.length === 0) {
        return;
      }

      const isVertical = normalizedKey === 'ArrowUp' || normalizedKey === 'ArrowDown';
      const delta = normalizedKey === 'ArrowUp' || normalizedKey === 'ArrowLeft' ? -1 : 1;

      if (isVertical) {
        const nextRow = Math.max(0, Math.min(liveBlocks.length - 1, currentRow + delta));
        setSelectedBlockIndex(nextRow);
        setHoveredBlockIndex(nextRow);
        setBlockActiveCell({ rowIndex: nextRow, key: currentKey });
        scrollToCell(nextRow, currentKey);
        return;
      }

      const currentCol = Math.max(0, BLOCK_COLUMN_ORDER.indexOf(currentKey));
      const nextCol = Math.max(0, Math.min(BLOCK_COLUMN_ORDER.length - 1, currentCol + delta));
      const nextKey = BLOCK_COLUMN_ORDER[nextCol] ?? 'name';
      setSelectedBlockIndex(currentRow);
      setHoveredBlockIndex(currentRow);
      setBlockActiveCell({ rowIndex: currentRow, key: nextKey });
      scrollToCell(currentRow, nextKey);
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [memoryMap, selectedBlockIndex, hoveredBlockIndex, blockActiveCell, onUpdate]);

  const toHex = (n: number) => `0x${Math.max(0, n).toString(16).toUpperCase()}`;
  const getBlockColor = (idx: number) => FIELD_COLOR_KEYS[idx % FIELD_COLOR_KEYS.length];

  return (
    <div className="flex flex-col w-full h-full min-h-0">
      {/* Header + AddressMapVisualizer */}
      <div className="vscode-surface border-b vscode-border p-8 flex flex-col gap-6 shrink-0 relative overflow-hidden">
        <div className="flex justify-between items-start relative z-10">
          <div>
            <h2 className="text-2xl font-bold font-mono tracking-tight">
              {memoryMap?.name ?? 'Memory Map'}
            </h2>
            <p className="vscode-muted text-sm mt-1 max-w-2xl">
              {memoryMap?.description ?? 'Address space layout'}
            </p>
          </div>
        </div>
        <div className="w-full relative z-10 mt-2 select-none">
          <AddressMapVisualizer
            blocks={blocks}
            hoveredBlockIndex={hoveredBlockIndex}
            setHoveredBlockIndex={setHoveredBlockIndex}
            onBlockClick={onNavigateToBlock}
          />
        </div>
      </div>

      {/* Blocks table */}
      <div className="flex-1 flex overflow-hidden min-h-0">
        <div className="flex-1 vscode-surface min-h-0 flex flex-col">
          <div
            ref={focusRef}
            tabIndex={0}
            data-blocks-table="true"
            className="flex-1 overflow-auto min-h-0 outline-none focus:outline-none"
          >
            {insertError ? (
              <div className="vscode-error px-4 py-2 text-xs">{insertError}</div>
            ) : null}
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
                            const val = Number.parseInt((e.target as HTMLInputElement).value, 0);
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
        </div>
      </div>
      <KeyboardShortcutsButton context="memoryMap" />
    </div>
  );
}
