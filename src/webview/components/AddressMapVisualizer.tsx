import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FIELD_COLORS, FIELD_COLOR_KEYS } from '../shared/colors';
import { toHex } from '../utils/formatUtils';
import { calculateBlockSize } from '../utils/blockSize';

export interface VisualizerAddressBlock {
  name?: string;
  baseAddress?: number | string;
  base_address?: number | string;
  offset?: number | string;
  size?: number | string;
  range?: number | string;
  usage?: string;
  registers?: Array<{
    __kind?: string;
    count?: number | string;
    stride?: number | string;
  }>;
}

interface AddressMapVisualizerProps {
  blocks: VisualizerAddressBlock[];
  hoveredBlockIndex?: number | null;
  setHoveredBlockIndex?: (idx: number | null) => void;
  onBlockClick?: (blockIndex: number) => void;
  onInsertAtGap?: (gapIndex: number) => void;
  onDeleteBlock?: (idx: number) => void;
  layout?: 'horizontal' | 'vertical';
}

function getBlockColor(idx: number) {
  return FIELD_COLOR_KEYS[idx % FIELD_COLOR_KEYS.length];
}

const AddressMapVisualizerInner: React.FC<AddressMapVisualizerProps> = ({
  blocks,
  hoveredBlockIndex = null,
  setHoveredBlockIndex = (_idx: number | null) => undefined,
  onBlockClick,
  onInsertAtGap,
  onDeleteBlock,
  layout = 'horizontal',
}) => {
  const [insertHoverGap, setInsertHoverGap] = useState<number | null>(null);
  const [insertBarScrollY, setInsertBarScrollY] = useState<number | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    blockIndex: number;
  } | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const insertClearRef = useRef<number | null>(null);
  const contextMenuRef = useRef<HTMLDivElement | null>(null);

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

  const handleContainerMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!onInsertAtGap) {
      return;
    }
    cancelInsertClear();
    const rows = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[data-viz-row]'));
    if (rows.length === 0) {
      return;
    }
    const THRESHOLD = 12;
    const mouseY = e.clientY;
    for (let i = 0; i <= rows.length; i++) {
      const gapViewportY =
        i === 0 ? rows[0].getBoundingClientRect().top : rows[i - 1].getBoundingClientRect().bottom;
      if (Math.abs(mouseY - gapViewportY) < THRESHOLD) {
        const containerEl = containerRef.current;
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

  // Group blocks by address ranges
  const groups = useMemo(() => {
    return blocks.map((block, idx) => {
      const base = block.baseAddress ?? block.base_address ?? block.offset ?? 0;
      const size = calculateBlockSize(block);
      return {
        idx,
        name: block.name ?? `Block ${idx}`,
        start: Number(base),
        end: Number(base) + Number(size) - 1,
        size,
        color: getBlockColor(idx),
        usage: block.usage ?? 'register',
      };
    });
  }, [blocks]);

  if (layout === 'vertical') {
    return (
      <div
        ref={containerRef}
        className="flex flex-col w-full relative"
        onMouseMove={handleContainerMouseMove}
        onMouseLeave={scheduleInsertClear}
      >
        {groups.map((group) => {
          const isHovered = hoveredBlockIndex === group.idx;
          return (
            <div
              key={group.idx}
              data-viz-row
              className={`flex items-center gap-3 px-3 py-2 border-b vscode-border select-none transition-colors ${
                isHovered ? 'vscode-row-hover' : ''
              }`}
              style={{ cursor: onBlockClick ? 'pointer' : 'default' }}
              onMouseEnter={() => setHoveredBlockIndex(group.idx)}
              onMouseLeave={() => setHoveredBlockIndex(null)}
              onClick={() => onBlockClick?.(group.idx)}
              onContextMenu={(e) => {
                if (!onInsertAtGap && !onDeleteBlock) {
                  return;
                }
                e.preventDefault();
                setContextMenu({ x: e.clientX, y: e.clientY, blockIndex: group.idx });
              }}
            >
              <div
                className="w-3 shrink-0 self-stretch rounded-sm"
                style={{
                  backgroundColor: FIELD_COLORS[group.color],
                  filter: isHovered ? 'saturate(1.15) brightness(1.05)' : undefined,
                }}
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-mono font-semibold text-sm truncate">{group.name}</span>
                  <span className="ipcraft-pattern-label text-[10px] font-mono shrink-0">
                    {group.usage === 'memory' ? 'MEM' : 'REG'}
                  </span>
                </div>
                <div className="text-[11px] vscode-muted font-mono">
                  {toHex(group.start)}
                  <span className="mx-1 opacity-50">→</span>
                  {toHex(group.end)}
                  <span className="ml-2 opacity-60">
                    {group.size < 1024
                      ? `${group.size}B`
                      : group.size < 1048576
                        ? `${(group.size / 1024).toFixed(1)}KB`
                        : `${(group.size / 1048576).toFixed(1)}MB`}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
        {onInsertAtGap && insertHoverGap !== null && insertBarScrollY !== null && (
          <div
            className="absolute left-0 right-0 z-20 flex items-center px-3 pointer-events-none"
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
                onInsertAtGap(insertHoverGap);
                setInsertHoverGap(null);
                setInsertBarScrollY(null);
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
        {contextMenu && (onInsertAtGap ?? onDeleteBlock) && (
          <div
            ref={contextMenuRef}
            className="fixed z-[200] min-w-[160px] rounded-lg shadow-xl border vscode-border vscode-surface overflow-hidden text-sm"
            style={{ left: contextMenu.x, top: contextMenu.y }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            {onInsertAtGap && (
              <button
                className="w-full text-left px-4 py-2 flex items-center gap-2 cursor-pointer hover:bg-[var(--vscode-list-hoverBackground)] transition-colors"
                onClick={() => {
                  onInsertAtGap(contextMenu.blockIndex);
                  setContextMenu(null);
                }}
              >
                <span className="codicon codicon-arrow-up text-xs" />
                Insert Above
              </button>
            )}
            {onInsertAtGap && (
              <button
                className="w-full text-left px-4 py-2 flex items-center gap-2 cursor-pointer hover:bg-[var(--vscode-list-hoverBackground)] transition-colors"
                onClick={() => {
                  onInsertAtGap(contextMenu.blockIndex + 1);
                  setContextMenu(null);
                }}
              >
                <span className="codicon codicon-arrow-down text-xs" />
                Insert Below
              </button>
            )}
            {onDeleteBlock && (
              <>
                <div className="border-t vscode-border my-0.5" />
                <button
                  className="w-full text-left px-4 py-2 flex items-center gap-2 cursor-pointer hover:bg-[var(--vscode-list-hoverBackground)] transition-colors"
                  style={{ color: 'var(--vscode-errorForeground)' }}
                  onClick={() => {
                    onDeleteBlock(contextMenu.blockIndex);
                    setContextMenu(null);
                  }}
                >
                  <span className="codicon codicon-trash text-xs" />
                  Delete
                </button>
              </>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="w-full">
      <div className="relative w-full flex items-start overflow-x-auto pb-2">
        {/* Address grid background */}
        {/* <div className="absolute inset-0 pointer-events-none fpga-bit-grid-bg bg-[size:32px_48px] rounded-lg" /> */}
        <div className="relative flex flex-row items-end gap-0 pl-4 pr-2 pt-12 pb-2 min-h-[64px] w-full">
          {groups.map((group, groupIdx) => {
            const isHovered = hoveredBlockIndex === group.idx;
            const separatorShadow = 'inset 0 0 0 1px var(--vscode-panel-border)';
            return (
              <div
                key={group.idx}
                className={`relative flex-1 flex flex-col items-center justify-end select-none min-w-[120px] ${isHovered ? 'z-10' : ''}`}
                style={{ cursor: onBlockClick ? 'pointer' : 'default' }}
                onMouseEnter={() => setHoveredBlockIndex(group.idx)}
                onMouseLeave={() => setHoveredBlockIndex(null)}
                onClick={() => onBlockClick?.(group.idx)}
              >
                <div
                  className="h-20 w-full overflow-hidden flex items-center justify-center px-2 rounded-md"
                  style={{
                    backgroundColor: FIELD_COLORS[group.color],
                    opacity: 1,
                    transform: isHovered ? 'translateY(-2px)' : undefined,
                    filter: isHovered ? 'saturate(1.15) brightness(1.05)' : undefined,
                    boxShadow: isHovered
                      ? `${separatorShadow}, 0 0 0 2px var(--vscode-focusBorder), 0 10px 20px color-mix(in srgb, var(--vscode-foreground) 22%, transparent)`
                      : separatorShadow,
                  }}
                >
                  <div className="flex flex-col items-center gap-0.5">
                    <span className="ipcraft-pattern-label text-[10px] font-mono font-semibold select-none text-center leading-tight">
                      {group.usage === 'memory' ? 'MEM' : 'REG'}
                    </span>
                  </div>
                </div>
                <div
                  className={`absolute -top-12 px-2 py-0.5 rounded border shadow text-xs whitespace-nowrap pointer-events-none ${
                    groupIdx === 0 ? 'left-0' : 'left-1/2 -translate-x-1/2'
                  }`}
                  style={{
                    background: 'var(--vscode-editorWidget-background)',
                    color: 'var(--vscode-foreground)',
                    borderColor: 'var(--vscode-panel-border)',
                  }}
                >
                  <div className="font-bold">
                    {group.name}
                    <span className="ml-2 vscode-muted font-mono text-[11px]">
                      [{toHex(group.start)}:{toHex(group.end)}]
                    </span>
                  </div>
                  <div className="text-[11px] vscode-muted font-mono">
                    {group.size < 1024
                      ? `${group.size}B`
                      : group.size < 1048576
                        ? `${(group.size / 1024).toFixed(1)}KB`
                        : `${(group.size / 1048576).toFixed(1)}MB`}
                  </div>
                </div>
                <div className="flex w-full justify-center">
                  <div className="text-center text-[11px] vscode-muted font-mono mt-1">
                    {toHex(group.start)}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

const AddressMapVisualizer = React.memo(
  AddressMapVisualizerInner,
  (prev, next) =>
    prev.blocks === next.blocks &&
    prev.hoveredBlockIndex === next.hoveredBlockIndex &&
    prev.setHoveredBlockIndex === next.setHoveredBlockIndex &&
    prev.onBlockClick === next.onBlockClick &&
    prev.onInsertAtGap === next.onInsertAtGap &&
    prev.onDeleteBlock === next.onDeleteBlock &&
    prev.layout === next.layout
);

export default AddressMapVisualizer;
